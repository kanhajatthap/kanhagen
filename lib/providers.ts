import sharp from "sharp";
import { buildImageUrl, PollinationsError, fetchPollinationsImage, POLLINATIONS_IMAGE_BASE } from "./pollinations";

export interface GenerateImageOptions {
  prompt: string;
  width?: number;
  height?: number;
  seed?: number;
  model?: string;
  style?: string;
}

export interface GeneratedImage {
  buffer: Buffer;
  mimeType: string;
  provider: string;
  model?: string;
  url?: string;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly details?: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

interface ImageProvider {
  name: string;
  isConfigured: () => boolean;
  generate: (opts: GenerateImageOptions) => Promise<GeneratedImage>;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Provider 1: Pollinations (free, no key required)
// ---------------------------------------------------------------------------

const POLLINATIONS_FALLBACK_MODELS = ["sana"];
const POLLINATIONS_BUDGET_MS = 30000;
const POLLINATIONS_MAX_FAILURES = 2;
const POLLINATIONS_RETRY_MS = 10 * 60 * 1000;

// In-memory circuit breaker: while Pollinations is having an outage, skip the
// slow 30s timeouts and fall through to the next provider. Auto-retries after
// the cooldown (or on server restart); a single success resets the counter.
const pollinationsHealth = { failures: 0, lastAttemptAt: 0 };

async function pollinationsGenerate(opts: GenerateImageOptions): Promise<GeneratedImage> {
  if (pollinationsHealth.failures > 0 && pollinationsHealth.failures >= POLLINATIONS_MAX_FAILURES) {
    if (Date.now() - pollinationsHealth.lastAttemptAt < POLLINATIONS_RETRY_MS) {
      const skipMs = POLLINATIONS_RETRY_MS - (Date.now() - pollinationsHealth.lastAttemptAt);
      throw new ProviderError(
        "Pollinations has been unavailable recently, skipping this attempt.",
        "pollinations",
        `Skipped after ${pollinationsHealth.failures} recent failures; will retry in ${Math.max(1, Math.round(skipMs / 1000))}s`,
      );
    }
  }

  const requested = opts.model && opts.model !== "default" ? opts.model : "flux";
  const candidates = Array.from(new Set([requested, "flux", ...POLLINATIONS_FALLBACK_MODELS]));
  const deadline = Date.now() + POLLINATIONS_BUDGET_MS;

  let lastError: unknown = null;

  for (const model of candidates) {
    if (Date.now() >= deadline) break;
    try {
      const url = buildImageUrl(encodeURIComponent(opts.prompt), {
        width: opts.width,
        height: opts.height,
        seed: opts.seed,
        model,
      });
      const { buffer, mimeType } = await fetchPollinationsImage(url, Math.max(5000, deadline - Date.now()));
      pollinationsHealth.failures = 0;
      return { buffer, mimeType, provider: "pollinations", model, url };
    } catch (e) {
      lastError = e;
    }
  }

  pollinationsHealth.failures += 1;
  pollinationsHealth.lastAttemptAt = Date.now();

  if (lastError instanceof PollinationsError) {
    throw new ProviderError(
      lastError.message,
      "pollinations",
      lastError.details || `All pollinations models failed: ${candidates.join(", ")}`,
    );
  }
  throw new ProviderError(
    `Pollinations failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    "pollinations",
  );
}

// ---------------------------------------------------------------------------
// Provider 2: Hugging Face Inference API (free token required)
// ---------------------------------------------------------------------------

const HF_IMAGE_MODELS = [
  process.env.HF_IMAGE_MODEL,
  "stabilityai/stable-diffusion-3-medium-diffusers",
  "stabilityai/stable-diffusion-xl-base-1.0",
  "runwayml/stable-diffusion-v1-5",
].filter((m): m is string => Boolean(m));

const HF_API_KEY = process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY;

async function huggingFaceGenerate(opts: GenerateImageOptions): Promise<GeneratedImage> {
  const candidates = Array.from(new Set(HF_IMAGE_MODELS));
  let lastError: unknown = null;

  for (const model of candidates) {
    try {
      // Legacy api-inference.huggingface.co was decommissioned in late 2025;
      // the Inference Providers router is the only supported endpoint now.
      const res = await fetchWithTimeout(
        `https://router.huggingface.co/hf-inference/models/${model}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${HF_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            inputs: opts.prompt,
            parameters: {
              ...(opts.width ? { width: opts.width } : {}),
              ...(opts.height ? { height: opts.height } : {}),
              ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
            },
          }),
        },
        60000,
      );

      const contentType = res.headers.get("content-type") || "";
      const buffer = Buffer.from(await res.arrayBuffer());

      if (!res.ok || contentType.includes("application/json")) {
        let msg = `HTTP ${res.status}`;
        try {
          const json = JSON.parse(buffer.toString("utf-8"));
          if (json?.error) msg = String(json.error);
        } catch {
          // ignore JSON parse errors, keep fallback message
        }
        // Surf the common "wrong/highly-permissioned token" problem clearly so
        // the user knows to enable "Inference Providers" on their HF token.
        if (res.status === 403) {
          msg += " Enable the \"Inference Providers\" permission on your Hugging Face token (https://huggingface.co/settings/tokens).";
        }
        throw new Error(msg);
      }

      return { buffer, mimeType: contentType || "image/png", provider: "huggingface", model };
    } catch (e) {
      lastError = e;
    }
  }

  throw new ProviderError(
    "Hugging Face image generation failed.",
    "huggingface",
    lastError instanceof Error ? lastError.message : String(lastError),
  );
}

// ---------------------------------------------------------------------------
// Provider 3: Google Gemini (native image generation, free API key required)
// ---------------------------------------------------------------------------

const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";

async function geminiGenerate(opts: GenerateImageOptions): Promise<GeneratedImage> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ProviderError("Google Gemini image generation failed.", "gemini", "GEMINI_API_KEY not set.");
  }
  const model = GEMINI_IMAGE_MODEL;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
      },
      90000,
    );

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      let message = typeof json?.error?.message === "string" ? json.error.message : `HTTP ${res.status}`;
      if (res.status === 429) {
        message += " The free Gemini plan has no image-generation quota for new accounts, so image requests are rejected. Enable billing in Google AI Studio (https://aistudio.google.com) to use Gemini images.";
      }
      throw new Error(message);
    }

    const parts: Array<{ inlineData?: { data?: string; mimeType?: string } }> | undefined = json?.candidates?.[0]?.content?.parts;
    const inline = Array.isArray(parts) ? parts.find((p) => p?.inlineData?.data) : undefined;

    if (!inline?.inlineData?.data) {
      throw new Error("Gemini returned no image data.");
    }

    const mimeType = typeof inline.inlineData.mimeType === "string" ? inline.inlineData.mimeType : "image/png";
    return { buffer: Buffer.from(inline.inlineData.data, "base64"), mimeType, provider: "gemini", model };
  } catch (e) {
    throw new ProviderError(
      "Google Gemini image generation failed.",
      "gemini",
      e instanceof Error ? e.message : String(e),
    );
  }
}

// ---------------------------------------------------------------------------
// Provider 4: Together AI (free API key required, OpenAI-compatible)
// ---------------------------------------------------------------------------

const TOGETHER_IMAGE_MODELS = [
  process.env.TOGETHER_IMAGE_MODEL,
  "FLUX.1-schnell-Free",
  "stabilityai/stable-diffusion-xl-base-1.0",
].filter((m): m is string => Boolean(m));

const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY;

async function togetherGenerate(opts: GenerateImageOptions): Promise<GeneratedImage> {
  const candidates = Array.from(new Set(TOGETHER_IMAGE_MODELS));
  let lastError: unknown = null;

  for (const model of candidates) {
    try {
      const size = `${opts.width || 1024}x${opts.height || 1024}`;
      const res = await fetchWithTimeout(
        "https://api.together.xyz/v1/images/generations",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${TOGETHER_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            prompt: opts.prompt,
            n: 1,
            size,
            ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
          }),
        },
        90000,
      );

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        const message =
          typeof json?.error?.message === "string"
            ? json.error.message
            : typeof json?.error === "string"
              ? json.error
              : `HTTP ${res.status}`;
        throw new Error(message);
      }

      const item = json?.data?.[0];
      if (!item) {
        throw new Error("Together returned no image data.");
      }

      if (item.b64_json) {
        return { buffer: Buffer.from(item.b64_json, "base64"), mimeType: "image/png", provider: "together", model };
      }
      if (typeof item.url === "string" && item.url) {
        const imgRes = await fetchWithTimeout(item.url, {}, 60000);
        if (!imgRes.ok) throw new Error(`Failed to download image from Together (HTTP ${imgRes.status})`);
        const contentType = imgRes.headers.get("content-type") || "image/png";
        return { buffer: Buffer.from(await imgRes.arrayBuffer()), mimeType: contentType, provider: "together", model };
      }
      throw new Error("Together response had no image URL or base64 data.");
    } catch (e) {
      lastError = e;
    }
  }

  throw new ProviderError(
    "Together AI image generation failed.",
    "together",
    lastError instanceof Error ? lastError.message : String(lastError),
  );
}

// ---------------------------------------------------------------------------
// Provider 5: Local offline dummy (always works, no external service needed)
// ---------------------------------------------------------------------------

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function localGenerate(opts: GenerateImageOptions): Promise<GeneratedImage> {
  const width = opts.width || 1024;
  const height = opts.height || 1024;
  const minDim = Math.min(width, height);

  const raw = (opts.prompt || "AI Studio Logo").trim();
  const safe = escapeXml(raw);

  const maxChars = Math.max(8, Math.floor(width / 26));
  const truncated = safe.length > maxChars ? `${safe.slice(0, maxChars - 1)}…` : safe;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#9333ea"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <circle cx="${width / 2}" cy="${height / 2 - minDim * 0.12}" r="${minDim * 0.2}" fill="rgba(255,255,255,0.92)"/>
  <text x="50%" y="${height / 2 - minDim * 0.12}" font-family="Arial, sans-serif" font-size="${minDim * 0.17}" font-weight="bold" fill="#6d28d9" text-anchor="middle" dominant-baseline="middle">AI</text>
  <text x="50%" y="${height - minDim * 0.17}" font-family="Arial, sans-serif" font-size="${minDim * 0.055}" fill="white" text-anchor="middle">${truncated}</text>
  <text x="50%" y="${height - minDim * 0.08}" font-family="Arial, sans-serif" font-size="${minDim * 0.038}" fill="rgba(255,255,255,0.75)" text-anchor="middle">Dummy logo · generated offline</text>
</svg>`;

  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return { buffer, mimeType: "image/png", provider: "local" };
}

// ---------------------------------------------------------------------------
// Provider 6: AI Horde (free, community-run, no billing or signup needed).
// Anonymous API key "0000000000" works out of the box; provide HORDE_API_KEY
// for better queue priority (still free). Bails out fast when the queue is
// crowded so the app never stalls waiting for a free worker.
// ---------------------------------------------------------------------------

const HORDE_API_BASE = "https://aihorde.net/api/v2";
const HORDE_CLIENT_AGENT = "web:ai-image-generator:0.1.0";
const HORDE_ANON_API_KEY = "0000000000";
const HORDE_MAX_WAIT_MS = 45000;

const HORDE_API_KEY = process.env.HORDE_API_KEY || HORDE_ANON_API_KEY;
const HORDE_MODELS = (
  process.env.HORDE_MODELS?.split(",").map((m) => m.trim()).filter(Boolean)
) ?? ["FLUX.1-dev", "SDXL_diffusers", "v5.1"];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function hordeRequest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetchWithTimeout(new URL(path, HORDE_API_BASE).toString(), init, 30000);
}

async function hordeDelete(id: string): Promise<void> {
  await hordeRequest(`/generate/status/${id}`, {
    method: "DELETE",
    headers: { "Client-Agent": HORDE_CLIENT_AGENT, apikey: HORDE_API_KEY },
  }).catch(() => {});
}

async function hordeGenerate(opts: GenerateImageOptions): Promise<GeneratedImage> {
  const width = opts.width || 1024;
  const height = opts.height || 1024;
  const seed = opts.seed ?? Math.floor(Math.random() * 100000000);

  const headers = {
    "Content-Type": "application/json",
    "Client-Agent": HORDE_CLIENT_AGENT,
    apikey: HORDE_API_KEY,
  };

  let lastError: unknown = null;
  const totalDeadline = Date.now() + HORDE_MAX_WAIT_MS;

  for (const model of HORDE_MODELS) {
    if (Date.now() >= totalDeadline) break;
    try {
      const submitRes = await hordeRequest("/generate/async", {
        method: "POST",
        headers,
        body: JSON.stringify({
          prompt: opts.prompt,
          nsfw: false,
          censor_nsfw: true,
          models: [model],
          params: {
            width,
            height,
            seed,
            steps: 12,
            cfg_scale: 4,
            sampler_name: "k_euler",
          },
        }),
      });
      const submit = await submitRes.json().catch(() => null);
      if (!submitRes.ok || !submit?.id) {
        const hordeError =
          (typeof submit?.message === "string" && submit.message) ||
          (typeof submit?.errors === "string" && submit.errors) ||
          `HTTP ${submitRes.status}`;
        throw new Error(`AI Horde rejected the request (${hordeError})`);
      }
      const id: string = submit.id;

      // Quick estimate: skip immediately if the queue is already way too long.
      const checkRes = await hordeRequest(`/generate/check/${id}`, { headers });
      const check = await checkRes.json().catch(() => null);
      if (check?.is_possible === false) {
        await hordeDelete(id);
        throw new Error("AI Horde cannot serve anonymous requests right now.");
      }
      const waitSeconds = Number(check?.wait_time ?? 0);
      const queuePosition = Number(check?.queue_position ?? 0);
      if (waitSeconds > 45 || queuePosition > 3) {
        await hordeDelete(id);
        throw new Error(`AI Horde queue crowded (pos ${queuePosition}, ~${Math.round(waitSeconds)}s)`);
      }

      while (Date.now() < totalDeadline) {
        await sleep(8000);
        const statusRes = await hordeRequest(`/generate/status/${id}`, { headers });
        const status = await statusRes.json().catch(() => null);
        if (!statusRes.ok) continue;
        if (status?.faulted === true) throw new Error("AI Horde generation faulted.");
        if (status?.done && Array.isArray(status?.generations) && status.generations.length > 0) {
          const g = status.generations[0];
          if (typeof g?.img === "string" && g.img) {
            return {
              buffer: Buffer.from(g.img, "base64"),
              mimeType: "image/png",
              provider: "horde",
              model: g.model || model,
            };
          }
        }
      }

      await hordeDelete(id);
      throw new Error("AI Horde queue too slow.");
    } catch (e) {
      lastError = e;
    }
  }

  throw new ProviderError(
    "AI Horde image generation failed.",
    "horde",
    lastError instanceof Error ? lastError.message : String(lastError),
  );
}

// ---------------------------------------------------------------------------
// Provider registry + failover
// ---------------------------------------------------------------------------

const providers: ImageProvider[] = [
  { name: "pollinations", isConfigured: () => true, generate: pollinationsGenerate },
  {
    name: "huggingface",
    isConfigured: () => Boolean(HF_API_KEY),
    generate: huggingFaceGenerate,
  },
  {
    name: "gemini",
    isConfigured: () => Boolean(process.env.GEMINI_API_KEY),
    generate: geminiGenerate,
  },
  {
    name: "together",
    isConfigured: () => Boolean(TOGETHER_API_KEY),
    generate: togetherGenerate,
  },
  // Free, community-run backup that needs no key or billing.
  { name: "horde", isConfigured: () => true, generate: hordeGenerate },
  // Last resort: offline dummy logo so generation never hard-fails when every
  // remote provider is down or rate-limited.
  { name: "local", isConfigured: () => true, generate: localGenerate },
];

export function getConfiguredProviders(): string[] {
  return providers.filter((p) => p.isConfigured()).map((p) => p.name);
}

export interface VariationRequest {
  prompt: string;
  width: number;
  height: number;
  model: string;
  style?: string;
  count: number;
}

export interface Variation {
  id: string;
  url: string;
  seed: number;
  prompt: string;
}

/** Hard cap on how many variations one request may ask for. */
export const MAX_VARIATIONS = 6;

/**
 * Builds the variation URLs for a prompt. Pure — no DB, no auth, no quota — so
 * both the /api/variations route and the in-app chat turn can call it directly
 * instead of one of them making an HTTP request to the other.
 */
export function buildVariations(req: VariationRequest): Variation[] {
  const count = Math.min(Math.max(Math.trunc(req.count) || 1, 1), MAX_VARIATIONS);
  const variationPrompt = req.style
    ? `${req.prompt}, ${req.style} style, variation`
    : `${req.prompt}, similar style and composition, variation`;

  const encodedPrompt = encodeURIComponent(variationPrompt);
  const baseSeed = Date.now();

  return Array.from({ length: count }, (_, i) => {
    const seed = baseSeed + i * 1000 + Math.floor(Math.random() * 100);
    const queryParams = new URLSearchParams();
    queryParams.set("width", String(req.width));
    queryParams.set("height", String(req.height));
    queryParams.set("seed", String(seed));
    queryParams.set("model", req.model);
    queryParams.set("nologo", "true");
    queryParams.set("private", "true");

    return {
      id: `var-${baseSeed}-${i}`,
      url: `${POLLINATIONS_IMAGE_BASE}/prompt/${encodedPrompt}?${queryParams.toString()}`,
      seed,
      prompt: variationPrompt,
    };
  });
}

export async function generateImageWithFallback(opts: GenerateImageOptions): Promise<GeneratedImage> {
  const errors: string[] = [];

  for (const provider of providers) {
    if (!provider.isConfigured()) continue;
    const started = Date.now();
    try {
      const image = await provider.generate(opts);
      console.info(`[providers] Generated image via ${image.provider}${image.model ? ` (${image.model})` : ""} in ${Date.now() - started}ms`);
      return image;
    } catch (e) {
      const message =
        e instanceof ProviderError
          ? e.details || e.message
          : e instanceof Error
            ? e.message
            : String(e);
      console.warn(`[providers] ${provider.name} failed after ${Date.now() - started}ms: ${message}`);
      errors.push(`${provider.name}: ${message}`);
    }
  }

  throw new ProviderError(
    "All image providers failed. Please try again in a moment.",
    "all",
    errors.join(" | "),
    502,
  );
}