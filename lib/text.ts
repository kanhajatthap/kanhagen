import { fetchPollinationsTextFromMessages } from "./pollinations";

export type TextProvider = "auto" | "gemini" | "pollinations";

export interface TextHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GeneratedText {
  text: string;
  provider: string;
  model: string;
}

export class TextProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly details?: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = "TextProviderError";
  }
}

export const TEXT_SYSTEM_PROMPT =
   "You are KanhaGen, a smart, friendly and concise assistant. " +
  "Answer in the same language the user writes in (Roman Hinglish is fine, matching the user). " +
  "Keep answers short and practical. Use Markdown (bold, lists, code blocks) when it makes the " +
  "answer clearer. Never invent facts; if unsure, say so. Use the conversation history to answer " +
  "follow-up questions with proper context.";

const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-3.1-flash-lite";
const GEMINI_TEXT_TIMEOUT_MS = 90000;

export type TextStreamEvent =
  | { kind: "delta"; text: string }
  | { kind: "done"; provider: string; model: string; text: string };

function buildGeminiContents(history: TextHistoryMessage[], latest: string): unknown[] {
  const contents: unknown[] = [];
  for (const msg of history) {
    contents.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    });
  }
  contents.push({ role: "user", parts: [{ text: latest }] });
  return contents;
}

async function* geminiTextStream(
  prompt: string,
  history: TextHistoryMessage[],
  systemPrompt: string = TEXT_SYSTEM_PROMPT,
): AsyncGenerator<TextStreamEvent> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new TextProviderError("Gemini is not configured.", "gemini");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TEXT_TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: buildGeminiContents(history, prompt),
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
        }),
        signal: controller.signal,
      },
    );

    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 300);
      throw new TextProviderError(
        `Gemini text generation failed (HTTP ${res.status}).`,
        "gemini",
        body || `HTTP ${res.status}`,
      );
    }

    if (!res.body) {
      throw new TextProviderError("Gemini returned no readable stream.", "gemini");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    const processChunk = (chunk: string) => {
      buffer += chunk.replace(/\r\n/g, "\n");
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of block.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let json: unknown;
          try {
            json = JSON.parse(payload);
          } catch {
            continue;
          }
          const candidates = (json as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          })?.candidates;
          const part = candidates?.[0]?.content?.parts?.[0]?.text;
          if (typeof part === "string" && part) {
            fullText += part;
          }
        }
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      processChunk(decoder.decode(value, { stream: true }));
      if (fullText) {
        yield { kind: "delta", text: fullText };
      }
    }

    const final = decoder.decode().replace(/\r\n/g, "\n");
    if (final) processChunk(final);
    if (!fullText.trim()) {
      throw new TextProviderError("Gemini returned an empty response.", "gemini");
    }
    yield { kind: "done", provider: "gemini", model: GEMINI_TEXT_MODEL, text: fullText };
  } catch (e) {
    if (e instanceof TextProviderError) throw e;
    throw new TextProviderError(
      e instanceof Error && e.name === "AbortError"
        ? `Gemini text generation timed out after ${GEMINI_TEXT_TIMEOUT_MS / 1000}s.`
        : "Gemini text generation failed.",
      "gemini",
      e instanceof Error ? e.message : String(e),
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function* pollinationsTextStream(
  prompt: string,
  history: TextHistoryMessage[],
  systemPrompt: string = TEXT_SYSTEM_PROMPT,
): AsyncGenerator<TextStreamEvent> {
  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...history.slice(-24),
    { role: "user" as const, content: prompt },
  ];
  const raw = await fetchPollinationsTextFromMessages(messages, "openai");

  const cleaned = cleanResponse(raw);
  if (looksLikeServiceError(cleaned)) {
    throw new TextProviderError(
      "Pollinations text returned a service error instead of an answer.",
      "pollinations",
      cleaned.slice(0, 300),
    );
  }

  yield { kind: "delta", text: cleaned };
  yield { kind: "done", provider: "pollinations", model: "openai", text: cleaned };
}

const SERVICE_ERROR_HINTS = [
  "doesn't have enough credits",
  "insufficient credits",
  "top up",
  "not enough credits",
  "rate limit",
  "api key",
];

export function looksLikeServiceError(text: string): boolean {
  const lower = text.toLowerCase();
  return SERVICE_ERROR_HINTS.some((hint) => lower.includes(hint));
}

export function cleanResponse(raw: string): string {
  let text = raw.trim();
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") {
      text = parsed;
    } else if (parsed.message && typeof parsed.message === "string") {
      text = parsed.message;
    } else if (parsed.content && typeof parsed.content === "string") {
      text = parsed.content;
    } else if (parsed.text && typeof parsed.text === "string") {
      text = parsed.text;
    } else if (parsed.response && typeof parsed.response === "string") {
      text = parsed.response;
    } else if (parsed.choices?.[0]?.message?.content) {
      text = parsed.choices[0].message.content;
    } else if (parsed.choices?.[0]?.text) {
      text = parsed.choices[0].text;
    }
  } catch {
    // Not JSON — use as-is.
  }

  text = text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z0-9]*\s*\n?/, "").replace(/\n?```$/, "").trim();
  }
  text = text.replace(/\n{3,}/g, "\n\n");
  return text;
}

interface TextStreamChoice {
  name: string;
  run: () => AsyncGenerator<TextStreamEvent>;
}

function buildChoices(
  prompt: string,
  history: TextHistoryMessage[],
  preferred: TextProvider,
  systemPrompt: string,
): TextStreamChoice[] {
  const auto: TextStreamChoice[] = [
    { name: "gemini", run: () => geminiTextStream(prompt, history, systemPrompt) },
    { name: "pollinations", run: () => pollinationsTextStream(prompt, history, systemPrompt) },
  ];
  if (preferred === "gemini") return [auto[0]];
  if (preferred === "pollinations") return [auto[1]];
  return auto;
}

// Streams a text reply through the configured providers in order. Emits
// "delta" events as tokens arrive and a final "done" event with the full text.
export async function* generateTextStream(
  prompt: string,
  history: TextHistoryMessage[],
  preferred: TextProvider = "auto",
  systemPrompt: string = TEXT_SYSTEM_PROMPT,
): AsyncGenerator<TextStreamEvent> {
  const choices = buildChoices(prompt, history, preferred, systemPrompt);
  const attempted: string[] = [];

  for (const choice of choices) {
    attempted.push(choice.name);
    const start = Date.now();
    let yielded = false;
    try {
      for await (const ev of choice.run()) {
        if (ev.kind === "delta") yielded = true;
        yield ev;
      }
      console.log(`[text] Generated response via ${choice.name} in ${Date.now() - start}ms`);
      return;
    } catch (e) {
      console.log(
        `[text] ${choice.name} failed after ${Date.now() - start}ms: ${e instanceof Error ? e.message : String(e)}`,
      );
      if (yielded) throw e;
    }
  }

  throw new TextProviderError(
    "All text providers failed. Please try again in a moment.",
    "all",
    `Tried: ${attempted.join(", ")}. All failed.`,
  );
}

export async function generateTextWithFallback(
  prompt: string,
  history: TextHistoryMessage[],
  preferred: TextProvider = "auto",
  systemPrompt: string = TEXT_SYSTEM_PROMPT,
): Promise<GeneratedText> {
  let result: GeneratedText = { text: "", provider: "unknown", model: "" };
  for await (const ev of generateTextStream(prompt, history, preferred, systemPrompt)) {
    if (ev.kind === "done") {
      result = { text: ev.text, provider: ev.provider, model: ev.model };
    }
  }
  return result;
}