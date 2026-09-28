import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTransport, sendPasswordResetEmail } from "../lib/mailer";

/**
 * The transport is chosen by which credentials exist, and the important part is
 * the *order*: Brevo wins because it is the one that works without a domain.
 * Getting that order wrong would silently fall back to Resend and fail every
 * send for accounts without a verified domain.
 */

const ENV_KEYS = [
  "BREVO_API_KEY",
  "BREVO_FROM_EMAIL",
  "BREVO_FROM_NAME",
  "RESEND_API_KEY",
  "MAIL_FROM",
] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of ENV_KEYS) delete process.env[key];
  // NODE_ENV is readonly under Next's types, so it has to be stubbed.
  vi.stubEnv("NODE_ENV", "production");
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const okResponse = { ok: true, status: 200, json: async () => ({}), text: async () => "" } as unknown as Response;

describe("resolveTransport", () => {
  it("prefers Brevo when both are configured", () => {
    process.env.BREVO_API_KEY = "brevo-key";
    process.env.BREVO_FROM_EMAIL = "me@example.com";
    process.env.RESEND_API_KEY = "resend-key";
    process.env.MAIL_FROM = "AI <x@example.com>";
    expect(resolveTransport()).toBe("brevo");
  });

  it("uses Resend when only Resend is configured", () => {
    process.env.RESEND_API_KEY = "resend-key";
    process.env.MAIL_FROM = "AI <x@example.com>";
    expect(resolveTransport()).toBe("resend");
  });

  it("ignores a half-configured Brevo (key without sender)", () => {
    process.env.BREVO_API_KEY = "brevo-key";
    expect(resolveTransport()).toBe("none");
  });

  it("ignores a half-configured Resend (key without from)", () => {
    process.env.RESEND_API_KEY = "resend-key";
    expect(resolveTransport()).toBe("none");
  });

  it("is dev-preview in development with nothing configured", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(resolveTransport()).toBe("dev-preview");
  });

  it("is none in production with nothing configured", () => {
    expect(resolveTransport()).toBe("none");
  });
});

describe("sendPasswordResetEmail", () => {
  const URL = "https://example.com/reset-password?token=abc";

  it("sends via Brevo with the api-key header", async () => {
    process.env.BREVO_API_KEY = "brevo-key";
    process.env.BREVO_FROM_EMAIL = "me@example.com";
    vi.mocked(fetch).mockResolvedValue(okResponse);

    const result = await sendPasswordResetEmail("user@example.com", URL);

    expect(result.delivered).toBe(true);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("brevo-key");

    const body = JSON.parse(init.body as string);
    expect(body.sender.email).toBe("me@example.com");
    expect(body.to).toEqual([{ email: "user@example.com" }]);
    expect(body.htmlContent).toContain(URL);
    // Plain-text alternative so the link is not hidden by a HTML-only client.
    expect(body.textContent).toContain(URL);
  });

  it("uses BREVO_FROM_NAME as the sender name", async () => {
    process.env.BREVO_API_KEY = "brevo-key";
    process.env.BREVO_FROM_EMAIL = "me@example.com";
    process.env.BREVO_FROM_NAME = "My Studio";
    vi.mocked(fetch).mockResolvedValue(okResponse);

    await sendPasswordResetEmail("user@example.com", URL);
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.sender.name).toBe("My Studio");
  });

  it("reports a Brevo rejection without throwing", async () => {
    process.env.BREVO_API_KEY = "brevo-key";
    process.env.BREVO_FROM_EMAIL = "me@example.com";
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" } as Response);

    const result = await sendPasswordResetEmail("user@example.com", URL);
    expect(result).toEqual({ delivered: false, error: "brevo_401" });
  });

  it("never throws when the network fails", async () => {
    process.env.BREVO_API_KEY = "brevo-key";
    process.env.BREVO_FROM_EMAIL = "me@example.com";
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNRESET"));

    const result = await sendPasswordResetEmail("user@example.com", URL);
    expect(result).toEqual({ delivered: false, error: "brevo_request_failed" });
  });

  it("returns a preview link in development instead of sending", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const result = await sendPasswordResetEmail("user@example.com", URL);
    expect(result).toEqual({ delivered: false, previewUrl: URL });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails without a preview link in production (no token leak)", async () => {
    const result = await sendPasswordResetEmail("user@example.com", URL);
    expect(result.delivered).toBe(false);
    expect(result.previewUrl).toBeUndefined();
    expect(result.error).toBe("mailer_not_configured");
  });
});
