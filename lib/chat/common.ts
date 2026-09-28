import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "../session";
import { ALLOWED_IMAGE_MIME, sniffImageMime } from "../imageMime";

export const MAX_HISTORY_MESSAGES = 30;
export const MAX_HISTORY_MESSAGE_CHARS = 2000;

/**
 * Upload limits enforced server-side. `maxBodyLength` / `experimental.proxyClientMaxBodySize`
 * are not applied to route handlers, so the only real bound is here: check the
 * declared Content-Length before buffering, then verify the actual bytes.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_PROMPT_CHARS = 2000;

export { ALLOWED_IMAGE_MIME };


/** Thrown when an upload is missing, the wrong type, or over the size cap. */
export class UploadError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

/**
 * Rejects oversized bodies before they are buffered. A missing/lying
 * Content-Length is not fatal here — `readUploadedImage` re-checks the real
 * byte count after reading, which is the authoritative check.
 */
export function assertBodySizeWithinLimit(req: Request, maxBytes = MAX_UPLOAD_BYTES): void {
  const declared = req.headers.get("content-length");
  if (!declared) return;
  const bytes = Number(declared);
  if (!Number.isFinite(bytes) || bytes < 0) return;
  if (bytes > maxBytes) {
    throw new UploadError(`Upload too large. Maximum size is ${Math.floor(maxBytes / (1024 * 1024))}MB.`, 413);
  }
}

/** Validates a multipart image part and returns its bytes as a Buffer. */
export async function readUploadedImage(
  file: File | null,
  maxBytes = MAX_UPLOAD_BYTES,
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (!file) throw new UploadError("Missing image.");

  if (file.type && !ALLOWED_IMAGE_MIME.has(file.type)) {
    throw new UploadError("Please upload a JPG, PNG, or WEBP image.");
  }
  if (file.size > maxBytes) {
    throw new UploadError(`Upload too large. Maximum size is ${Math.floor(maxBytes / (1024 * 1024))}MB.`, 413);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Authoritative check: the declared size can lie, the decoded bytes cannot.
  if (buffer.length === 0) throw new UploadError("Uploaded image is empty.");
  if (buffer.length > maxBytes) {
    throw new UploadError(`Upload too large. Maximum size is ${Math.floor(maxBytes / (1024 * 1024))}MB.`, 413);
  }

  // The declared Content-Type is fully client-controlled, so require the bytes
  // to actually be one of the allowed image formats. Without this, a script
  // renamed to .png sails through the allowlist above and gets forwarded to the
  // remote vision provider as if it were a real image.
  const sniffed = sniffImageMime(buffer);
  if (!sniffed) {
    throw new UploadError("That file is not a valid JPG, PNG, or WEBP image.");
  }
  return { buffer, mimeType: sniffed };
}


export type HistoryMessage = { role: "user" | "assistant"; content: string };

/**
 * Validate + cap the conversation history sent by the client so the model only
 * ever receives clean, bounded user/assistant turns.
 */
export function sanitizeHistory(raw: unknown): HistoryMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const { role, content } = rec;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    const trimmed = content.trim();
    if (!trimmed) continue;
    out.push({ role, content: trimmed.slice(0, MAX_HISTORY_MESSAGE_CHARS) });
    if (out.length >= MAX_HISTORY_MESSAGES) break;
  }
  return out;
}

export interface ParsedChatRequest {
  prompt: string;
  historyId: string;
  discussionHistory: HistoryMessage[];
  streamRequested: boolean;
  forceText: boolean;
  textModel: "auto" | "gemini" | "pollinations";
  /** Opt-in: images are private unless the client explicitly asks otherwise. */
  isPublic: boolean;
  uploadedImage?: { buffer: Buffer; mimeType: string };
}

/** Normalizes a POST to /api/chat (JSON or multipart, with optional image). */
export async function parseChatRequest(req: Request): Promise<ParsedChatRequest> {
  const parsed: ParsedChatRequest = {
    prompt: "",
    historyId: "",
    discussionHistory: [],
    streamRequested: false,
    forceText: false,
    textModel: "auto",
    isPublic: false,
  };
  const contentType = req.headers.get("content-type") || "";

  // Reject oversized bodies before anything is buffered into memory.
  assertBodySizeWithinLimit(req);

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    parsed.prompt = ((formData.get("prompt") as string) || "").trim().slice(0, MAX_PROMPT_CHARS);
    parsed.historyId = (formData.get("historyId") as string) || "";
    const rawHistory = formData.get("history");
    try {
      parsed.discussionHistory = rawHistory ? sanitizeHistory(JSON.parse(String(rawHistory))) : [];
    } catch {
      parsed.discussionHistory = [];
    }
    const imageFile = formData.get("image") as File | null;
    if (imageFile) {
      parsed.uploadedImage = await readUploadedImage(imageFile);
    }
    parsed.isPublic = formData.get("isPublic") === "true";
  } else {
    const body = await req.json().catch(() => null);
    parsed.prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, MAX_PROMPT_CHARS) : "";
    parsed.historyId = typeof body?.historyId === "string" ? body.historyId.trim() : "";
    parsed.discussionHistory = sanitizeHistory(body?.history);
    parsed.streamRequested = body?.stream === true;
    parsed.forceText = body?.forceText === true;
    parsed.isPublic = body?.isPublic === true;
    const rawTextModel = body?.textModel;
    parsed.textModel =
      rawTextModel === "gemini" || rawTextModel === "pollinations" ? rawTextModel : "auto";
  }

  return parsed;
}

export interface SessionUser {
  userId: string;
  email: string;
  name: string;
}

/** Reads + verifies the session cookie; null when not logged in. */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const session = sessionToken ? await verifySessionToken(sessionToken) : null;
    if (!session?.userId) return null;
    return { userId: session.userId, email: session.email || "", name: session.name || "User" };
  } catch {
    return null;
  }
}

// Image generation detection - only for explicit image keywords. Kept strict so
// plain chat questions ("what does this design mean") don't silently switch
// into image mode.
export function isImageGenerationRequest(prompt: string): boolean {
  const imageKeywords = [
    "image", "photo", "picture", "generate image", "create image",
    "draw", "paint", "sketch", "illustration", "logo", "design",
    "poster", "vector", "icon", "art", "artwork", "render", "3d",
  ];
  const lower = prompt.toLowerCase();
  return imageKeywords.some((word) => lower.includes(word));
}

/** Resolves the conversationId this historyId belongs to (or null for a new chat). */
export async function resolveConversationId(
  db: Db,
  userId: string,
  historyId: string,
): Promise<string | null> {
  if (!historyId || !ObjectId.isValid(historyId)) return null;
  const existing = await db
    .collection("image_history")
    .findOne(
      { _id: new ObjectId(historyId), userId },
      { projection: { conversationId: 1 } },
    );
  if (!existing) return null;
  return typeof existing.conversationId === "string" && existing.conversationId
    ? existing.conversationId
    : historyId;
}