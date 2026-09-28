import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyCaptcha, isCaptchaConfigured } from "../lib/turnstile";

/**
 * The captcha is the only thing standing between a bot and the auth endpoints,
 * so the interesting cases are the ones where it must refuse:
 *
 *  - no secret configured (a misconfigured deploy must not silently pass)
 *  - no token sent at all (the classic bypass: just omit the field)
 *  - Cloudflare unreachable (cannot prove the token is genuine => deny)
 *  - token minted for a different site
 *
 * `verifyCaptcha` calls Cloudflare over the network, so every test here stubs
 * `fetch`. Nothing in this file talks to the real service.
 */

const ENV_KEYS = ["TURNSTILE_SECRET_KEY", "TURNSTILE_EXPECTED_HOSTNAME"] as const;
let saved: Record<string, string | undefined>;

function siteverify(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  // NODE_ENV is readonly under Next's types, so it has to be stubbed.
  vi.stubEnv("NODE_ENV", "production");
  delete process.env.TURNSTILE_EXPECTED_HOSTNAME;
  vi.stubGlobal("fetch", vi.fn());
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

describe("isCaptchaConfigured", () => {
  it("reports whether a secret is present", () => {
    expect(isCaptchaConfigured()).toBe(true);
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(isCaptchaConfigured()).toBe(false);
  });
});

describe("verifyCaptcha", () => {
  it("accepts a valid token", async () => {
    vi.mocked(fetch).mockResolvedValue(siteverify({ success: true, hostname: "example.com" }));
    const result = await verifyCaptcha("valid-token");
    expect(result).toEqual({ ok: true, hostname: "example.com" });
  });

  it("posts the secret and token to the siteverify endpoint", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(siteverify({ success: true, hostname: "example.com" }));

    await verifyCaptcha("my-token", { remoteIp: "203.0.113.9" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");

    const form = init.body as FormData;
    expect(form.get("secret")).toBe("test-secret");
    expect(form.get("response")).toBe("my-token");
    expect(form.get("remoteip")).toBe("203.0.113.9");
  });

  it("rejects a request with no token", async () => {
    for (const bad of [undefined, null, "", 0, false, {}, 42]) {
      const result = await verifyCaptcha(bad);
      expect(result.ok).toBe(false);
    }
    // Crucially, it never calls out to Cloudflare for a missing token.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects when Cloudflare reports failure", async () => {
    vi.mocked(fetch).mockResolvedValue(siteverify({ success: false, "error-codes": ["invalid-input-response"] }));
    const result = await verifyCaptcha("bad-token");
    expect(result).toEqual({ ok: false, reason: "invalid-input-response" });
  });

  it("rejects when Cloudflare returns a non-2xx", async () => {
    vi.mocked(fetch).mockResolvedValue(siteverify({}, false, 500));
    const result = await verifyCaptcha("token");
    expect(result).toEqual({ ok: false, reason: "http_500" });
  });

  it("rejects when the verification request throws", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));
    const result = await verifyCaptcha("token");
    expect(result).toEqual({ ok: false, reason: "request_failed" });
  });

  it("rejects a replayed token (timeout-or-duplicate)", async () => {
    vi.mocked(fetch).mockResolvedValue(siteverify({ success: false, "error-codes": ["timeout-or-duplicate"] }));
    const result = await verifyCaptcha("used-token");
    expect(result).toEqual({ ok: false, reason: "timeout-or-duplicate" });
  });

  describe("missing secret", () => {
    it("fails closed in production", async () => {
      delete process.env.TURNSTILE_SECRET_KEY;
      const result = await verifyCaptcha("any-token");
      expect(result).toEqual({ ok: false, reason: "not_configured" });
      expect(fetch).not.toHaveBeenCalled();
    });

    it("allows the request in development so local work needs no credentials", async () => {
      delete process.env.TURNSTILE_SECRET_KEY;
      vi.stubEnv("NODE_ENV", "development");
      const result = await verifyCaptcha("anything");
      expect(result).toEqual({ ok: true, skipped: true });
    });
  });

  describe("hostname binding", () => {
    it("accepts a token from the expected hostname", async () => {
      process.env.TURNSTILE_EXPECTED_HOSTNAME = "app.example.com";
      vi.mocked(fetch).mockResolvedValue(siteverify({ success: true, hostname: "app.example.com" }));
      expect((await verifyCaptcha("tok")).ok).toBe(true);
    });

    it("rejects a token minted on another site", async () => {
      process.env.TURNSTILE_EXPECTED_HOSTNAME = "app.example.com";
      vi.mocked(fetch).mockResolvedValue(siteverify({ success: true, hostname: "attacker.example" }));
      expect(await verifyCaptcha("tok")).toEqual({ ok: false, reason: "hostname_mismatch" });
    });

    it("rejects a response with no hostname at all", async () => {
      process.env.TURNSTILE_EXPECTED_HOSTNAME = "app.example.com";
      vi.mocked(fetch).mockResolvedValue(siteverify({ success: true }));
      expect(await verifyCaptcha("tok")).toEqual({ ok: false, reason: "hostname_mismatch" });
    });
  });

  describe("action binding", () => {
    it("accepts a matching action", async () => {
      vi.mocked(fetch).mockResolvedValue(siteverify({ success: true, hostname: "h", action: "login" }));
      expect((await verifyCaptcha("tok", { expectedAction: "login" })).ok).toBe(true);
    });

    it("rejects a token issued for a different form", async () => {
      vi.mocked(fetch).mockResolvedValue(siteverify({ success: true, hostname: "h", action: "signup" }));
      // A token harvested from the signup form must not unlock login.
      expect(await verifyCaptcha("tok", { expectedAction: "login" })).toEqual({
        ok: false,
        reason: "action_mismatch",
      });
    });
  });
});
