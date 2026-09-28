import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { NextResponse } from "next/server";
import {
  addUserMemoryFacts,
  buildMemorySystemPrompt,
  extractMemoryFacts,
  getUserMemory,
} from "../memory";
import { markPromptSeen } from "../bloomFilter";
import { generateTextStream, generateTextWithFallback, TextProviderError } from "../text";
import { PollinationsError } from "../pollinations";
import { QuotaExceededError, refundQuota, spendQuota } from "../quota";
import { quotaErrorResponse } from "../httpError";
import { resolveConversationId, type HistoryMessage, type ParsedChatRequest, type SessionUser } from "./common";
import { TEXT_SYSTEM_PROMPT } from "../text";

const encoder = new TextEncoder();
const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * Handles a text turn (streaming SSE or plain JSON). Charges one text credit up
 * front, loads cross-chat memory, generates, persists history and extracts any
 * new personal facts the user shared.
 */
export async function handleTextTurn(
  db: Db,
  user: SessionUser,
  req: ParsedChatRequest,
): Promise<Response> {
  const { prompt, discussionHistory, streamRequested, forceText, textModel } = req;

  try {
    await spendQuota(db, user.userId, "text", 1);
  } catch (e) {
    if (e instanceof QuotaExceededError) return quotaErrorResponse(e);
    throw e;
  }

  // Load the user's cross-chat memory and fold it into the system prompt so
  // facts told in earlier conversations are remembered here too.
  let memorySystemPrompt = TEXT_SYSTEM_PROMPT;
  try {
    const memory = await getUserMemory(db, user.userId);
    memorySystemPrompt = buildMemorySystemPrompt(memory);
  } catch (e) {
    console.log("[text] Memory load failed:", e);
  }

  // Persist any new personal fact the user shares in this turn (e.g. "my name
  // is X"). Cheap gate: only runs for explicit intro phrases.
  const saveMemoryFacts = async () => {
    if (forceText) return;
    try {
      const facts = await extractMemoryFacts(prompt);
      if (facts.length) {
        await addUserMemoryFacts(db, user.userId, facts);
      }
    } catch (e) {
      console.log("[text] Memory extraction failed:", e);
    }
  };

  const conversationId = await resolveConversationId(db, user.userId, req.historyId);

  // Bloom-filter duplicate detection (approximate, only surfaces a hint).
  const duplicatePrompt = !forceText && markPromptSeen(user.userId, prompt);

  if (streamRequested) {
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let historyIdOut = conversationId || "";
        let provider = "";
        let model = "";
        // Tracks whether this turn actually produced an answer, so a failure
        // refunds the credit charged up front.
        let refunded = false;
        try {
          for await (const ev of generateTextStream(prompt, discussionHistory, textModel, memorySystemPrompt)) {
            if (ev.kind === "delta") {
              controller.enqueue(encoder.encode(sse("delta", { text: ev.text })));
            } else if (ev.kind === "done") {
              provider = ev.provider;
              model = ev.model;
              if (!forceText) {
                const newId = new ObjectId();
                await db.collection("image_history").insertOne({
                  _id: newId,
                  userId: user.userId,
                  prompt,
                  model: `${provider}-text`,
                  mimeType: "text/plain",
                  generatedText: ev.text,
                  conversationId: conversationId || newId.toString(),
                  createdAt: new Date(),
                });
                historyIdOut = conversationId || newId.toString();
              }
              await saveMemoryFacts();
            }
          }
          controller.enqueue(encoder.encode(sse("done", { historyId: historyIdOut, provider, model, duplicate: duplicatePrompt })));
        } catch (error) {
          console.error("Text streaming error:", error);
          // `details` is logged, never streamed — it can carry upstream URLs.
          const mapped =
            error instanceof PollinationsError || error instanceof TextProviderError
              ? { error: error.message, status: error.status }
              : {
                  error: "Failed to generate the response. Please try again.",
                  status: 502,
                };
          controller.enqueue(encoder.encode(sse("error", mapped)));
          refunded = true;
        } finally {
          if (refunded) await refundQuota(db, user.userId, "text", 1).catch(() => {});
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  let generatedText;
  try {
    generatedText = await generateTextWithFallback(prompt, discussionHistory, textModel, memorySystemPrompt);
  } catch (error) {
    console.error("Text generation error:", error);
    // No answer was produced, so refund the credit.
    await refundQuota(db, user.userId, "text", 1).catch((e) =>
      console.error("Quota refund failed:", e),
    );
    if (error instanceof PollinationsError || error instanceof TextProviderError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "Failed to fetch text response. Please try again." },
      { status: 502 },
    );
  }

  const cleanMessage = generatedText.text;

  // Save to history (skip tool calls like prompt-enhancement).
  const savedId = new ObjectId();
  if (!forceText) {
    await db.collection("image_history").insertOne({
      _id: savedId,
      userId: user.userId,
      prompt,
      model: `${generatedText.provider}-text`,
      mimeType: "text/plain",
      generatedText: cleanMessage,
      conversationId: conversationId || savedId.toString(),
      createdAt: new Date(),
    });
  }
  await saveMemoryFacts();

  return NextResponse.json({
    type: "text",
    text: cleanMessage,
    provider: generatedText.provider,
    model: generatedText.model,
    duplicate: duplicatePrompt,
    historyId: conversationId || savedId.toString(),
  }, { status: 200 });
}

export type { HistoryMessage };