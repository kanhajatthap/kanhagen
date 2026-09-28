 "use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Sidebar, type HistoryListItem } from "../components/Sidebar";
import { ChatWindow } from "../components/ChatWindow";
import type { ChatMessageModel, Variation } from "../components/ChatMessage";
import { PromptInput, type PromptInputHandle, PromptInputOptions } from "../components/PromptInput";
import { useTheme } from "../components/ThemeProvider";
import { toast } from "sonner";
import { Menu, X, Moon, Sun, BrainCircuit, LogIn, UserPlus, Search, Images, MessageSquare } from "lucide-react";

const ACTIVE_CHAT_KEY = "aig-active-chat";

type QuotaOverview = {
  image: { limit: number; used: number; remaining: number };
  text: { limit: number; used: number; remaining: number };
  resetAt: string;
  resetLabel: string;
};

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type HistoryTurn = {
  id?: string;
  prompt?: string;
  type?: string;
  mimeType?: string;
  generatedText?: string;
  response?: string;
  imageUrl?: string;
  variations?: Variation[];
  createdAt?: string;
};

async function getErrorMessage(res: Response, fallback: string): Promise<string> {
  const json = await res.json().catch(() => null);
  const msg = (json && typeof json.error === "string" && json.error) || fallback;
  const details = (json && typeof json.details === "string" && json.details) || "";
  const base = res.status >= 500 ? `${msg} (HTTP ${res.status})` : msg;
  return details ? `${base} — ${details}` : base;
}

type SseOutcome =
  | { ok: true; historyId?: string; provider?: string; model?: string; duplicate?: boolean }
  | { ok: false; error: string; details?: string };

// Reads a text/event-stream response from /api/chat. Calls onDelta() with the
// accumulated text as tokens arrive. Resolves once the stream ends.
async function readChatSse(res: Response, onDelta: (text: string) => void): Promise<SseOutcome> {
  if (!res.body) {
    return { ok: false, error: "Could not read the response stream." };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outcome: SseOutcome = { ok: true };

  const handleBlock = (block: string): boolean => {
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data = line.slice(5).trim();
    }
    if (!data) return true;
    try {
      const json = JSON.parse(data);
      if (event === "delta" && typeof json.text === "string") {
        onDelta(json.text);
      } else if (event === "error") {
        outcome = {
          ok: false,
          error: typeof json.error === "string" ? json.error : "Generation failed.",
          details: typeof json.details === "string" ? json.details : undefined,
        };
        return false;
      } else if (event === "done") {
        outcome = {
          ok: true,
          historyId: typeof json.historyId === "string" ? json.historyId : undefined,
          provider: typeof json.provider === "string" ? json.provider : undefined,
          model: typeof json.model === "string" ? json.model : undefined,
          duplicate: json.duplicate === true,
        };
      }
    } catch {
      // Ignore malformed data lines.
    }
    return true;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (!handleBlock(block)) return outcome;
    }
  }
  if (buffer.trim()) handleBlock(buffer);
  return outcome;
}

// Flatten the visible chat into prior user/assistant turns so the AI can
// answer follow-ups using conversation context.
function buildHistory(msgs: ChatMessageModel[]): Array<{ role: "user" | "assistant"; content: string }> {
  return msgs
    .filter((m) => {
      if (m.typing || m.isError) return false;
      if (m.role === "assistant" && m.type === "image") return false;
      if (m.role === "assistant" && m.variations && m.variations.length > 0) return false;
      return typeof m.content === "string" && m.content.trim().length > 0;
    })
    .slice(-30)
    .map((m) => ({ role: m.role, content: m.content.trim() }));
}

export default function Home() {
  const { theme, toggle } = useTheme();
  const [history, setHistory] = useState<HistoryListItem[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null);
  const [authUser, setAuthUser] = useState<{ name: string; email: string } | null>(null);
  const [quota, setQuota] = useState<QuotaOverview | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const promptInputRef = useRef<PromptInputHandle>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  const isLoggedIn = !!authUser;

  const loadQuota = async () => {
    try {
      const res = await fetch("/api/quota", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        setQuota(json?.image && json?.text ? json : null);
      } else {
        setQuota(null);
      }
    } catch {
      setQuota(null);
    }
  };

  const loadUser = async () => {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    if (!res.ok) {
      setAuthUser(null);
      return;
    }
    const json = await res.json();
    setAuthUser(json?.user || null);
  };

  const loadHistoryList = async () => {
    const res = await fetch("/api/history", { cache: "no-store" });
    if (!res.ok) {
      setHistory([]);
      return;
    }
    const json = await res.json();
    const source = Array.isArray(json?.conversations)
      ? json.conversations
      : Array.isArray(json?.items)
        ? json.items
        : [];
    const items: Array<{ id: string; prompt: string; title?: string; pinned?: boolean; createdAt: string }> = source;
    setHistory(
      items.map((x) => ({
        id: x.id,
        prompt: x.prompt,
        title: x.title,
        pinned: x.pinned,
        createdAt: x.createdAt,
      })),
    );
  };

  useEffect(() => {
    const restore = async () => {
      await loadUser();
      loadHistoryList();
      loadQuota();
      // Reopen the chat that was active before the refresh, like ChatGPT does.
      const stored = localStorage.getItem(ACTIVE_CHAT_KEY);
      if (stored) openHistory(stored);
    };
    restore();
  }, []);

  // Close mobile drawer on outside click + lock body scroll
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.body.style.overflow = prev;
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    const onNewChat = () => newChat();
    const onOpenHistory = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string }>).detail;
      if (detail?.id) openHistory(detail.id);
    };
    const onRename = () => {
      if (!activeHistoryId) return;
      const t = prompt("Enter a title for this conversation:");
      if (t?.trim()) renameHistory(activeHistoryId, t.trim());
    };
    const onDelete = () => {
      if (!activeHistoryId) return;
      if (confirm("Delete this conversation?")) deleteHistory(activeHistoryId);
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("palette:new-chat", onNewChat);
    window.addEventListener("palette:open-history", onOpenHistory);
    window.addEventListener("palette:rename", onRename);
    window.addEventListener("palette:delete", onDelete);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("palette:new-chat", onNewChat);
      window.removeEventListener("palette:open-history", onOpenHistory);
      window.removeEventListener("palette:rename", onRename);
      window.removeEventListener("palette:delete", onDelete);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHistoryId]);

  const newChat = () => {
    setActiveHistoryId(null);
    setMessages([]);
    localStorage.removeItem(ACTIVE_CHAT_KEY);
    setMobileMenuOpen(false);
  };

  const openHistory = async (id: string) => {
    setActiveHistoryId(id);
    localStorage.setItem(ACTIVE_CHAT_KEY, id);
    setMobileMenuOpen(false);
    const res = await fetch(`/api/history/${id}`, { cache: "no-store" });
    if (!res.ok) {
      if (res.status === 401 || res.status === 404) {
        setActiveHistoryId(null);
        setMessages([]);
        localStorage.removeItem(ACTIVE_CHAT_KEY);
      }
      return;
    }
    const json = await res.json();
    const convId = json?.conversationId || id;
    const turns = Array.isArray(json?.items) ? (json.items as HistoryTurn[]) : [];
    if (!turns.length) return;

    const built: ChatMessageModel[] = [];
    for (const t of turns) {
      const createdAt: string = t.createdAt || new Date().toISOString();
      built.push({ id: uid(), role: "user", content: t.prompt || "…", createdAt });
      const base = { id: uid(), role: "assistant" as const, createdAt, historyId: convId };
      if (t.type === "image") {
        built.push({ ...base, content: t.prompt || "", type: "image", imageUrl: t.imageUrl, prompt: t.prompt });
      } else if (t.type === "vision") {
        built.push({ ...base, content: t.response || t.generatedText || "", type: "vision" });
      } else if (t.type === "batch") {
        built.push({
          ...base,
          content: `Generated ${t.variations?.length ?? 0} images`,
          type: "text",
          prompt: t.prompt,
          variations: t.variations || [],
        });
      } else {
        built.push({ ...base, content: t.generatedText || "", type: "text" });
      }
    }

    if (convId !== id) {
      setActiveHistoryId(convId);
      localStorage.setItem(ACTIVE_CHAT_KEY, convId);
    }
    setMessages(built);
  };

  const deleteHistory = async (id: string) => {
    const res = await fetch("/api/history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: id }),
    });
    if (!res.ok) return;
    setHistory((prev) => prev.filter((x) => x.id !== id));
    if (activeHistoryId === id) newChat();
  };

  const renameHistory = async (id: string, title: string) => {
    const res = await fetch("/api/history", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title }),
    });
    if (!res.ok) return;
    setHistory((prev) => prev.map((x) => (x.id === id ? { ...x, title } : x)));
  };

  const togglePinHistory = async (id: string) => {
    const current = history.find((x) => x.id === id);
    const pinned = !current?.pinned;
    const res = await fetch("/api/history", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, pinned }),
    });
    if (!res.ok) return;
    await loadHistoryList();
  };

  const canSend = useMemo(() => {
    const now = Date.now();
    const isRateLimited = rateLimitUntil !== null && now < rateLimitUntil;
    // Block only when BOTH credits are gone — one empty bucket still lets the
    // other mode work.
    const allExhausted =
      quota !== null && quota.image.remaining === 0 && quota.text.remaining === 0;
    return isLoggedIn && !busy && !isRateLimited && !allExhausted;
  }, [isLoggedIn, busy, rateLimitUntil, quota]);

  const markError = (content: string, retryPrompt?: string) => ({
    typing: false,
    streaming: false,
    content,
    isError: true,
    ...(retryPrompt ? { retryPrompt } : {}),
  });

  const handleRetry = (prompt: string) => {
    sendPrompt({
      prompt,
      width: 1024,
      height: 1024,
      model: "flux",
    });
  };

  const enhancePrompt = async (prompt: string): Promise<string> => {
    let res: Response;
    try {
      res = await fetch(`/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Expand and enrich this prompt so it produces better results — add more detail, style, lighting and mood. Return only the enhanced prompt text with no commentary or quotes. Original prompt: "${prompt}"`,
          forceText: true,
        }),
      });
    } catch {
      throw new Error("Could not reach the server. Check your internet connection and try again.");
    }

    if (!res.ok) {
      const errText = await getErrorMessage(res, "Failed to enhance the prompt.");
      throw new Error(errText);
    }

    const json = await res.json();
    if (json?.type === "text" && typeof json.text === "string" && json.text.trim()) {
      return json.text.trim();
    }
    throw new Error(json?.error || "The enhancer returned an unexpected response. Please try again.");
  };

  const sendPrompt = async (options: PromptInputOptions) => {
    if (busy) {
      return;
    }

    // Check rate limit cooldown
    if (rateLimitUntil !== null && Date.now() < rateLimitUntil) {
      return;
    }

    if (!isLoggedIn) {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          content: "Please login first to generate and save your history.",
          createdAt: new Date().toISOString(),
        },
      ]);
      return;
    }

    const { prompt, image, batchCount } = options;
    const isPublic = options.isPublic === true;
    if (image) {
      console.log("[PAGE] Image details:", image.name, image.size, image.type);
    }

    if (batchCount && batchCount > 1) {
      const now = new Date().toISOString();
      const userMsg: ChatMessageModel = {
        id: uid(),
        role: "user",
        content: prompt,
        createdAt: now,
      };
      const typingMsg: ChatMessageModel = {
        id: uid(),
        role: "assistant",
        content: `Generating ${batchCount} images...`,
        createdAt: now,
        typing: true,
      };
      setMessages((prev) => [...prev, userMsg, typingMsg]);
      setBusy(true);

      try {
        let res: Response;
        try {
          res = await fetch("/api/batch-generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt,
              count: batchCount,
              width: options.width,
              height: options.height,
              model: options.model,
              historyId: activeHistoryId || undefined,
              isPublic,
            }),
          });
        } catch {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === typingMsg.id
                ? { ...m, ...markError("Could not reach the server. Check your internet connection and try again.", prompt) }
                : m,
            ),
          );
          return;
        }

        if (!res.ok) {
          const errText = await getErrorMessage(res, "Failed to generate batch. Please try again.");
          setMessages((prev) =>
            prev.map((m) => (m.id === typingMsg.id ? { ...m, ...markError(errText, prompt) } : m)),
          );
          return;
        }

        const json = await res.json();
        const batchImages: Variation[] =
          (json.images as Array<{ id?: string; url?: string; seed?: number }> | undefined)
            ?.filter((img): img is { id: string; url: string; seed?: number } => Boolean(img.id && img.url))
            .map((img) => ({ id: img.id, url: img.url, seed: img.seed ?? 0, prompt })) || [];
        setMessages((prev) =>
          prev.map((m) =>
            m.id === typingMsg.id ? {
              ...m,
              typing: false,
              type: "text",
              content: `Generated ${batchCount} images:`,
              prompt: prompt,
              variations: batchImages,
              historyId: json.historyId,
            } : m,
          ),
        );
        if (json?.historyId) {
          setActiveHistoryId(json.historyId);
          localStorage.setItem(ACTIVE_CHAT_KEY, json.historyId);
        }
        await loadHistoryList();
      } finally {
        setBusy(false);
        loadQuota();
      }
      return;
    }

    const now = new Date().toISOString();
    const userMsg: ChatMessageModel = {
      id: uid(),
      role: "user",
      content: prompt,
      createdAt: now,
      imageUrl: image ? URL.createObjectURL(image) : undefined,
    };
    const typingMsg: ChatMessageModel = {
      id: uid(),
      role: "assistant",
      content: prompt,
      createdAt: now,
      typing: true,
    };
    setMessages((prev) => [...prev, userMsg, typingMsg]);
    setBusy(true);

try {
        let res: Response;
        try {
          if (image) {
            const formData = new FormData();
            formData.append("prompt", prompt);
            formData.append("history", JSON.stringify(buildHistory(messages)));
            formData.append("historyId", activeHistoryId || "");
            formData.append("isPublic", String(isPublic));
            formData.append("image", image);
            res = await fetch("/api/chat", {
              method: "POST",
              body: formData,
            });
} else {
            res = await fetch("/api/chat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                prompt,
                history: buildHistory(messages),
                historyId: activeHistoryId || undefined,
                stream: true,
                textModel: options.textModel || "auto",
                isPublic,
              }),
            });
          }
        } catch {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === typingMsg.id
                ? { ...m, ...markError("Could not reach the server. Check your internet connection and try again.", prompt) }
                : m,
            ),
          );
          toast.error("Could not reach the server. Please try again.");
          return;
        }

        if (!res.ok) {
          if (res.status === 429) {
            const json = await res.json().catch(() => null);
            // Daily credits are over — tell them exactly when they reset.
            if (json && json.quotaExceeded) {
              const msg = typeof json.error === "string" ? json.error : "Daily credits exhausted.";
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === typingMsg.id
                    ? { ...m, typing: false, content: msg }
                    : m,
                ),
              );
              toast.error(msg);
              await loadQuota();
              return;
            }
            const cooldownMs = 15000; // 15 seconds
            setRateLimitUntil(Date.now() + cooldownMs);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === typingMsg.id
                  ? { ...m, typing: false, content: "Rate limit reached. Please wait 15 seconds before trying again." }
                  : m,
              ),
            );
            toast.error("Rate limit reached. Please wait 15 seconds before trying again.");
            // Clear cooldown after 15 seconds
            setTimeout(() => setRateLimitUntil(null), cooldownMs);
            return;
          }

          const errText = await getErrorMessage(res, "Failed to generate. Please try again.");
          setMessages((prev) =>
            prev.map((m) => (m.id === typingMsg.id ? { ...m, ...markError(errText, prompt) } : m)),
          );
          toast.error(errText);
          return;
        }

        // Streaming text responses come back as text/event-stream; everything
        // else (image / vision / variations) remains a JSON response.
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("text/event-stream")) {
          let streamed = "";
          const outcome = await readChatSse(res, (text) => {
            streamed = text;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === typingMsg.id
                  ? { ...m, typing: false, streaming: true, type: "text", content: streamed }
                  : m,
              ),
            );
          });

          if (!outcome.ok) {
            const errText = outcome.details ? `${outcome.error} — ${outcome.details}` : outcome.error;
            setMessages((prev) => prev.map((m) => (m.id === typingMsg.id ? { ...m, ...markError(errText, prompt) } : m)));
            toast.error(outcome.error);
            return;
          }

          setMessages((prev) =>
            prev.map((m) =>
              m.id === typingMsg.id
                ? { ...m, typing: false, streaming: false, type: "text", content: streamed, historyId: outcome.historyId }
                : m,
            ),
          );
          if (outcome.historyId) {
            setActiveHistoryId(outcome.historyId);
            localStorage.setItem(ACTIVE_CHAT_KEY, outcome.historyId);
          }
          if (outcome.duplicate) {
            toast.info("You've asked this before — try adding more detail for a new angle?");
          }
          await loadHistoryList();
          return;
        }

      // Parse JSON response from API
      const json = await res.json();

      if (json.type === "image") {
        // Display generated image from URL
        setMessages((prev) =>
          prev.map((m) =>
            m.id === typingMsg.id ? {
              ...m,
              typing: false,
              type: "image",
              imageUrl: json.url,
              prompt: prompt,
              historyId: json.historyId,
            } : m,
          ),
        );
      } else if (json.type === "vision") {
        // Display OCR text only (no image)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === typingMsg.id ? {
              ...m,
              typing: false,
              type: "vision",
              content: json.text,
              prompt: prompt,
              historyId: json.historyId,
            } : m,
          ),
        );
      } else if (json.type === "text") {
        // Display text response
        setMessages((prev) =>
          prev.map((m) =>
            m.id === typingMsg.id ? { ...m, typing: false, type: "text", content: json.text, historyId: json.historyId } : m,
          ),
        );
        if (json.duplicate === true) {
          toast.info("You've asked this before — try adding more detail for a new angle?");
        }
      } else if (json.type === "variations") {
        // Display variations grid - don't set imageUrl to avoid loading issues
        setMessages((prev) =>
          prev.map((m) =>
            m.id === typingMsg.id ? {
              ...m,
              typing: false,
              type: "text",
              content: "Generated similar images:",
              prompt: json.prompt,
              variations: json.variations,
              historyId: json.historyId,
            } : m,
          ),
        );
      }

      if (json?.historyId) {
        setActiveHistoryId(json.historyId);
        localStorage.setItem(ACTIVE_CHAT_KEY, json.historyId);
      }
      await loadHistoryList();
    } finally {
      setBusy(false);
      loadQuota();
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthUser(null);
    setQuota(null);
    newChat();
    toast.success("Logged out");
  };

const useSuggestion = (prompt: string) => {
    promptInputRef.current?.setValue(prompt);
  };

  return (
    <div className="h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="flex h-full">
        <Sidebar
          items={history}
          activeId={activeHistoryId}
          onNewChat={newChat}
          onSelect={openHistory}
          onDelete={deleteHistory}
          onRename={renameHistory}
          onTogglePin={togglePinHistory}
          authUser={authUser}
          onLogout={logout}
        />

        {/* Mobile drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-zoom-fade"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div
              ref={mobileMenuRef}
              className="absolute left-0 top-0 bottom-0 h-full shadow-2xl animate-reveal-up"
            >
              <Sidebar
                items={history}
                activeId={activeHistoryId}
                onNewChat={newChat}
                onSelect={openHistory}
                onDelete={deleteHistory}
                onRename={renameHistory}
                onTogglePin={togglePinHistory}
                authUser={authUser}
                onLogout={logout}
                className="flex h-full w-[280px] flex-col"
              />
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="absolute -right-12 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white text-zinc-600 shadow-lg dark:bg-zinc-800 dark:text-zinc-200"
                title="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}

        <div className="flex h-full flex-1 flex-col overflow-hidden">
          <header className="flex items-center justify-between border-b border-gray-200/80 bg-white/80 px-4 py-4 backdrop-blur-md transition-all duration-300 sm:px-6 dark:border-zinc-800/80 dark:bg-zinc-950/80">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 text-zinc-600 transition-colors hover:bg-gray-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 md:hidden"
                title="Open menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-md shadow-indigo-500/20">
                <BrainCircuit className="h-5 w-5 text-white" />
              </div>
              <div>
                <span className="font-heading text-base font-semibold text-zinc-800 dark:text-zinc-100">
                  KanhaGen
                </span>
                <span className="hidden text-xs text-zinc-500 dark:text-zinc-400 sm:block">
                  Images, text &amp; vision — all in one place
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 text-sm">
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent("palette:open"))}
                className="group flex h-9 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-zinc-500 transition-all duration-200 hover:border-indigo-300 hover:text-indigo-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-indigo-600 dark:hover:text-indigo-300"
                title="Search (Ctrl+K)"
              >
                <Search className="h-4 w-4" />
                <span className="hidden text-xs lg:inline">Search</span>
                <kbd className="hidden rounded border border-zinc-200 px-1 text-[10px] font-medium text-zinc-400 group-hover:border-indigo-200 dark:border-zinc-700 sm:inline dark:group-hover:border-indigo-700">
                  Ctrl K
                </kbd>
              </button>

              <button
                type="button"
                onClick={toggle}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 transition-all duration-200 hover:bg-gray-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>

              {quota && isLoggedIn && (
                <div
                  className="hidden items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-600 sm:flex dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                  title={`Daily credits reset: ${quota.resetLabel} (IST)`}
                >
                  <span
                    className={`flex items-center gap-1 ${quota.image.remaining === 0 ? "text-red-500" : ""}`}
                    title="Image credits remaining today"
                  >
                    <Images className="h-3.5 w-3.5" />
                    {quota.image.remaining}/{quota.image.limit}
                  </span>
                  <span className="text-zinc-300 dark:text-zinc-600">·</span>
                  <span
                    className={`flex items-center gap-1 ${quota.text.remaining === 0 ? "text-red-500" : ""}`}
                    title="Chat credits remaining today"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    {quota.text.remaining}/{quota.text.limit}
                  </span>
                </div>
              )}

              {!authUser && (
                <div className="ml-2 hidden items-center gap-2 sm:flex">
                  <Link
                    href="/login"
                    className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-all duration-200 hover:border-gray-300 hover:bg-gray-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
                  >
                    <LogIn className="h-4 w-4" />
                    Login
                  </Link>
                  <Link
                    href="/signup"
                    className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-4 py-2 text-sm font-medium text-white shadow-md shadow-indigo-500/20 transition-all duration-200 hover:shadow-lg hover:shadow-indigo-500/30"
                  >
                    <UserPlus className="h-4 w-4" />
                    Sign up
                  </Link>
                </div>
              )}
            </div>
          </header>

          {quota && isLoggedIn && (
            <div
              className="flex items-center justify-center gap-4 border-b border-zinc-200/60 bg-zinc-50/70 px-3 py-1.5 text-xs font-medium text-zinc-600 sm:hidden dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300"
              title={`Daily credits reset: ${quota.resetLabel} (IST)`}
            >
              <span
                className={`flex items-center gap-1 ${quota.image.remaining === 0 ? "text-red-500" : ""}`}
                title="Image credits remaining today"
              >
                <Images className="h-3 w-3" />
                {quota.image.remaining}/{quota.image.limit} images
              </span>
              <span
                className={`flex items-center gap-1 ${quota.text.remaining === 0 ? "text-red-500" : ""}`}
                title="Chat credits remaining today"
              >
                <MessageSquare className="h-3 w-3" />
                {quota.text.remaining}/{quota.text.limit} chats
              </span>
            </div>
          )}

          <ChatWindow messages={messages} onSuggestion={useSuggestion} onRetry={handleRetry} />

          {quota && isLoggedIn && (quota.image.remaining === 0 || quota.text.remaining === 0) && (
            <div className="border-b border-amber-200/70 bg-amber-50/80 px-6 py-2 text-center text-xs font-medium text-amber-800 backdrop-blur-sm dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
              Aaj ke free credits khatam ho gaye — naye credits {quota.resetLabel} (IST) ko milenge.
            </div>
          )}

          <PromptInput
            ref={promptInputRef}
            onSend={sendPrompt}
            onEnhance={enhancePrompt}
            onOCRResult={(text) => {
              const ocrMsg: ChatMessageModel = {
                id: uid(),
                role: "assistant",
                content: text,
                type: "text",
                createdAt: new Date().toISOString(),
              };
              setMessages((prev) => [...prev, ocrMsg]);
            }}
            disabled={!canSend}
          />

          {!isLoggedIn && (
            <div className="border-t border-gray-200/80 bg-white/60 px-6 py-3 text-center text-xs text-zinc-500 backdrop-blur-sm dark:border-zinc-800/80 dark:bg-zinc-950/60 dark:text-zinc-400">
              Login required to generate images (so your history can be saved).
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
