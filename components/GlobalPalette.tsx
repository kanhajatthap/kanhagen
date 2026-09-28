"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Search, FileText, Sparkles, PenLine, LogIn, UserPlus, Trash2, History, CornerDownLeft } from "lucide-react";

type HistoryItem = {
  id: string;
  prompt: string;
  createdAt: string;
};

type PaletteEntry = {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  action: () => void;
};

export function GlobalPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/history?limit=5", { cache: "no-store" });
      if (!res.ok) {
        setItems([]);
        return;
      }
      const json = await res.json();
      const list: HistoryItem[] = Array.isArray(json?.items)
        ? json.items.map((x: { id: string; prompt: string; createdAt: string }) => ({
            id: x.id,
            prompt: x.prompt,
            createdAt: x.createdAt,
          }))
        : [];
      setItems(list);
    } finally {
      setLoading(false);
    }
  }, []);

  // Always refetch on open. A module-level cache outlived the session and
  // showed the previous user's prompts after a logout/login switch.
  const openPalette = useCallback(() => {
    setOpen(true);
    setQuery("");
    setActive(0);
    loadHistory();
  }, [loadHistory]);

  const closePalette = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (open) closePalette();
        else openPalette();
      }
    };
    const onOpen = () => openPalette();
    document.addEventListener("keydown", onKey);
    window.addEventListener("palette:open", onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("palette:open", onOpen);
    };
  }, [open, openPalette, closePalette]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const entries = useMemo<PaletteEntry[]>(() => {
    const q = query.trim().toLowerCase();
    const out: PaletteEntry[] = [];

    const pages = [
      { title: "New chat", subtitle: "Create a fresh prompt", icon: <Sparkles className="h-4 w-4" />, action: () => { window.dispatchEvent(new CustomEvent("palette:new-chat")); closePalette(); } },
      { title: "Explore images", subtitle: "Browse community creations", icon: <Search className="h-4 w-4" />, action: () => { router.push("/explore"); closePalette(); } },
      { title: "My history", subtitle: "View all your generations", icon: <History className="h-4 w-4" />, action: () => { router.push("/history"); closePalette(); } },
      { title: "Login", subtitle: "Sign in to your account", icon: <LogIn className="h-4 w-4" />, action: () => { router.push("/login"); closePalette(); } },
      { title: "Create account", subtitle: "Get started for free", icon: <UserPlus className="h-4 w-4" />, action: () => { router.push("/signup"); closePalette(); } },
    ].filter((p) => !q || p.title.toLowerCase().includes(q) || (p.subtitle || "").toLowerCase().includes(q));
    pages.forEach((p, i) => out.push({ id: `page-${i}`, group: "Pages", ...p }));

    const recent = items
      .filter((it) => !q || it.prompt.toLowerCase().includes(q))
      .slice(0, 5)
      .map((it): PaletteEntry => ({
        id: `hist-${it.id}`,
        group: "Recent images",
        title: it.prompt,
        icon: <FileText className="h-4 w-4" />,
        action: () => {
          window.dispatchEvent(new CustomEvent("palette:open-history", { detail: { id: it.id } }));
          closePalette();
        },
      }));
    out.push(...recent);

    const actions = [
      { title: "Rename conversation", icon: <PenLine className="h-4 w-4" />, action: () => { window.dispatchEvent(new CustomEvent("palette:rename")); closePalette(); } },
      { title: "Delete conversation", icon: <Trash2 className="h-4 w-4" />, action: () => { window.dispatchEvent(new CustomEvent("palette:delete")); closePalette(); } },
    ].filter((a) => !q || a.title.toLowerCase().includes(q));
    actions.forEach((a, i) => out.push({ id: `action-${i}`, group: "Actions", ...a }));

    return out;
  }, [query, items, router, closePalette]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;
    const focused = el.querySelector<HTMLElement>(`[data-index="${active}"]`);
    focused?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const run = (entry: PaletteEntry) => entry.action();

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(entries.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = entries[active];
      if (entry) run(entry);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[120] flex items-start justify-center bg-black/40 p-4 pt-[15vh] backdrop-blur-sm"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) closePalette();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center gap-3 border-b border-zinc-100 px-4 dark:border-zinc-800">
              <Search className="h-5 w-5 shrink-0 text-zinc-400" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search pages, prompts, actions..."
                className="w-full bg-transparent py-3.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
              />
              <kbd className="hidden shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 sm:block dark:border-zinc-700 dark:bg-zinc-800">
                ESC
              </kbd>
            </div>

            <div ref={listRef} className="max-h-[45vh] overflow-y-auto p-2">
              {loading && items.length === 0 && (
                <div className="space-y-2 p-2">
                  {[0, 1, 2, 3].map((_, i) => (
                    <div key={i} className="h-10 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
                  ))}
                </div>
              )}

              {!loading && entries.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-zinc-400">
                  No results for &ldquo;{query}&rdquo;
                </p>
              )}

              {entries.length > 0 &&
                entries.reduce<React.ReactNode[]>((acc, entry, i) => {
                  const prevGroup = i === 0 ? null : entries[i - 1].group;
                  if (prevGroup !== entry.group) {
                    acc.push(
                      <div key={`group-${entry.group}`} className="mt-3 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 first:mt-1 dark:text-zinc-500">
                        {entry.group}
                      </div>,
                    );
                  }
                  const isActive = i === active;
                  acc.push(
                    <button
                      key={entry.id}
                      data-index={i}
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => run(entry)}
                      className={[
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                        isActive ? "bg-indigo-50 dark:bg-indigo-500/15" : "",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                          isActive
                            ? "bg-gradient-to-br from-indigo-500 to-purple-600 text-white"
                            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
                        ].join(" ")}
                      >
                        {entry.icon}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                          {entry.title}
                        </span>
                        {entry.subtitle && (
                          <span className="truncate text-xs text-zinc-400">{entry.subtitle}</span>
                        )}
                      </span>
                      {isActive && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-zinc-400" />}
                    </button>,
                  );
                  return acc;
                }, [])}
            </div>

            <div className="flex items-center gap-3 border-t border-zinc-100 px-4 py-2 text-[11px] text-zinc-400 dark:border-zinc-800">
              <span className="flex items-center gap-1">
                <kbd className="rounded-md border border-zinc-200 bg-zinc-50 px-1 py-px text-[10px] font-medium dark:border-zinc-700 dark:bg-zinc-800">↑↓</kbd>
                to navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded-md border border-zinc-200 bg-zinc-50 px-1 py-px text-[10px] font-medium dark:border-zinc-700 dark:bg-zinc-800">↵</kbd>
                to select
              </span>
              <span className="ml-auto">
                <kbd className="rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-px text-[10px] font-medium dark:border-zinc-700 dark:bg-zinc-800">Ctrl/⌘ K</kbd>
                to toggle
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}