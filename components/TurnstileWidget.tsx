"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Cloudflare Turnstile widget.
 *
 * Uses the official explicit-render API rather than a wrapper library so no new
 * dependency is pulled in. The widget is only the client-side gesture â€” the
 * token it hands back must still be verified server-side with
 * `verifyCaptcha`, which is the part that actually protects the route.
 *
 * Notes:
 *  - The script is loaded once per page and shared between widget instances.
 *  - `resetKey` lets the parent clear a spent token after a failed submit
 *    (Turnstile tokens are single-use, so a rejected login cannot reuse it).
 *  - With no site key the widget renders nothing and reports "skipped"; the
 *    server then decides (it allows this in development, denies in production).
 */

const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      theme?: "light" | "dark" | "auto";
      size?: "normal" | "compact" | "flexible";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      "timeout-callback"?: () => void;
    },
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// Shared across every instance so a page with two forms loads the script once.
let loader: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loader) return loader;

  loader = new Promise<TurnstileApi>((resolve, reject) => {
    const onLoad = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("turnstile loaded but global is missing"));
    };

    // Already in the DOM (hot reload, or a second mount before onload fired).
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", onLoad);
      existing.addEventListener("error", () => reject(new Error("turnstile script failed to load")));
      // The global may already be there even if the load event already fired.
      if (window.turnstile) onLoad();
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", onLoad);
    script.addEventListener("error", () => {
      loader = null;
      reject(new Error("turnstile script failed to load"));
    });
    document.head.appendChild(script);
  });

  return loader;
}

export interface TurnstileWidgetProps {
  onVerify: (token: string) => void;
  /** Change this value to force a reset, e.g. after a failed submit. */
  resetKey?: unknown;
  /** Turnstile ties the token to this name, so a token from one form can't be replayed on another. */
  action?: string;
  theme?: "light" | "dark" | "auto";
  className?: string;
  /** Rendered in place of the widget when it can't load. Defaults to a short notice. */
  fallback?: string;
}

export default function TurnstileWidget({
  onVerify,
  resetKey,
  action,
  theme = "auto",
  className,
  fallback = "Verification is unavailable right now. Please refresh the page.",
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);

  // The widget is rendered once but the parent's callback identity changes on
  // every render, so route the latest one through a ref instead of re-rendering
  // the challenge. The sync lives in an effect because writing a ref during
  // render is not allowed.
  const onVerifyRef = useRef(onVerify);
  useEffect(() => {
    onVerifyRef.current = onVerify;
  }, [onVerify]);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  // Removes the widget from Cloudflare's registry and clears the handle. Safe to
  // call repeatedly, and after the container has already left the DOM.
  const teardown = () => {
    const id = widgetIdRef.current;
    if (!id || typeof window === "undefined" || !window.turnstile) return;
    try {
      window.turnstile.remove(id);
    } catch {
      // The iframe may already be gone; nothing to clean up.
    }
    widgetIdRef.current = null;
  };

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;

    let cancelled = false;
    const container = containerRef.current;

    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.isConnected) return;
        setFailed(false);
        widgetIdRef.current = api.render(container, {
          sitekey: siteKey,
          action,
          theme,
          callback: (token: string) => onVerifyRef.current(token),
          "expired-callback": () => onVerifyRef.current(""),
          // The challenge itself failed (bad site key, hostname not registered,
          // blocked script). Tear the widget down *before* switching to the
          // fallback, otherwise its container disappears while Cloudflare still
          // holds a handle on it and a later reset() throws.
          "error-callback": () => {
            teardown();
            setFailed(true);
            onVerifyRef.current("");
          },
          "timeout-callback": () => {
            teardown();
            setFailed(true);
            onVerifyRef.current("");
          },
        });
      })
      .catch((error) => {
        // Leave the token empty; the server will reject the request, which is the
        // correct fail-closed outcome rather than a form that silently bypasses.
        console.error("[Turnstile]", error);
        setFailed(true);
        onVerifyRef.current("");
      });

    return () => {
      cancelled = true;
      teardown();
    };
  }, [siteKey, action, theme]);

  // A spent token can't be reused, so clear it whenever the parent asks.
  useEffect(() => {
    if (resetKey === undefined || !widgetIdRef.current || !window.turnstile) return;
    // Reset only while the widget is still mounted. After a failed challenge the
    // container is replaced by the fallback, and resetting an orphaned widget
    // makes Cloudflare throw "Nothing to reset found for provided container" â€”
    // an uncaught error that tears down the whole page.
    if (!containerRef.current?.isConnected) return;
    try {
      window.turnstile.reset(widgetIdRef.current);
    } catch (error) {
      console.warn("[Turnstile] reset failed:", error);
    }
    onVerifyRef.current("");
  }, [resetKey]);

  if (!siteKey) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-400">
        Verification is not configured. Add <code>NEXT_PUBLIC_TURNSTILE_SITE_KEY</code> and redeploy.
      </p>
    );
  }

  if (failed) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-400">
        {fallback}
      </p>
    );
  }

  return <div ref={containerRef} className={className} />;
}
