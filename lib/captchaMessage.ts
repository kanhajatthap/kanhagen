/**
 * Turns a captcha rejection `code` into something a person can act on.
 *
 * Without this every misconfiguration collapses into the same anonymous
 * "verification failed", which makes a broken deployment look identical to a
 * user simply needing a retry. The messages are deliberately specific about
 * *what to do*, and never reveal anything about the request itself.
 */

const MESSAGES: Record<string, string> = {
  // The widget never produced a token. Almost always means the site key is
  // missing from the build, or the challenge is blocked/failed to load.
  missing_token: "The verification box did not load. Please refresh the page and try again.",
  not_configured: "Verification is not set up on this server yet. Please contact support.",
  // Cloudflare says the challenge did not complete — usually a stale or
  // already-used token, or a hostname that is not registered on the widget.
  "invalid-input-response": "The verification expired. Please refresh the page and try again.",
  "timeout-or-duplicate": "The verification expired. Please refresh the page and try again.",
  "hostname-mismatch": "The verification was issued for a different site. Please refresh and try again.",
  // Reached only if the browser hit the endpoint directly without solving it.
  action_mismatch: "Please complete the verification box and try again.",
};

export function captchaMessage(code: unknown): string | null {
  if (typeof code !== "string" || !code) return null;
  if (code.startsWith("http_")) {
    return "The verification service is not responding. Please try again in a minute.";
  }
  if (code === "request_failed" || code === "verification_failed") {
    return "The verification service is not responding. Please try again in a minute.";
  }
  return MESSAGES[code] ?? "Verification failed. Please refresh the page and try again.";
}
