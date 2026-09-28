/**
 * Cloudflare Turnstile verification (server side).
 *
 * The browser widget is only a client-side gesture; the actual gate is this
 * function. A form that trusts the widget without calling siteverify can be
 * bypassed by simply not sending a token at all, so every protected route must
 * call `verifyCaptcha` and honour the result.
 *
 * Design decisions worth knowing:
 *
 *  - **Fail closed in production.** If the secret is missing, a production
 *    request is rejected rather than waved through. An unconfigured captcha
 *    silently protecting nothing is the worst possible failure mode. In
 *    development we allow it through, so local work doesn't need credentials.
 *  - **Network failures deny.** If Cloudflare can't be reached we cannot know
 *    the token is genuine, so it doesn't count.
 *  - **Timeout.** A hanging verification call must not hold the request open;
 *    5s is long enough for Cloudflare and short enough to stay invisible.
 *  - **Hostname check (optional).** Turnstile tokens are bound to the site they
 *    were issued for. If `TURNSTILE_EXPECTED_HOSTNAME` is set, a token minted on
 *    some other site is rejected, which stops a token being harvested from an
 *    attacker's page and replayed here.
 */

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 5000;

export const CAPTCHA_FIELD = "captchaToken";

export type CaptchaOutcome =
  | { ok: true; skipped: true }
  | { ok: true; skipped?: undefined; hostname: string }
  | { ok: false; reason: string };

interface SiteverifyResponse {
  success: boolean;
  "error-codes"?: string[];
  hostname?: string;
  action?: string;
  cdata?: string;
}

/** True when a secret is configured, i.e. the captcha is actually enforcing. */
export function isCaptchaConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

export async function verifyCaptcha(
  token: unknown,
  options: { remoteIp?: string; expectedAction?: string } = {},
): Promise<CaptchaOutcome> {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[captcha] TURNSTILE_SECRET_KEY is not set — rejecting the request. " +
          "Set the secret in the deployment environment, otherwise these forms stay unusable.",
      );
      return { ok: false, reason: "not_configured" };
    }
    // Local development only: no credentials required.
    return { ok: true, skipped: true };
  }

  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "missing_token" };
  }

  let body: SiteverifyResponse;
  try {
    const form = new FormData();
    form.append("secret", secret);
    form.append("response", token);
    if (options.remoteIp) form.append("remoteip", options.remoteIp);

    const res = await fetch(VERIFY_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!res.ok) {
      console.error(`[captcha] siteverify returned HTTP ${res.status}`);
      return { ok: false, reason: `http_${res.status}` };
    }

    body = (await res.json()) as SiteverifyResponse;
  } catch (error) {
    console.error("[captcha] siteverify request failed:", error);
    return { ok: false, reason: "request_failed" };
  }

  if (!body.success) {
    // Codes are safe to log (e.g. "timeout-or-duplicate", "invalid-input-response").
    return { ok: false, reason: (body["error-codes"] ?? ["verification_failed"]).join(",") };
  }

  const expectedHost = process.env.TURNSTILE_EXPECTED_HOSTNAME;
  if (expectedHost && body.hostname !== expectedHost) {
    console.warn(`[captcha] token hostname mismatch: got ${body.hostname ?? "none"}`);
    return { ok: false, reason: "hostname_mismatch" };
  }

  if (options.expectedAction && body.action !== options.expectedAction) {
    return { ok: false, reason: "action_mismatch" };
  }

  return { ok: true, hostname: body.hostname ?? "unknown" };
}
