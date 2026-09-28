import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, MAX_REQUESTS } from "../lib/rateLimit";
import { getClientIp } from "../lib/request";

describe("checkRateLimit (sliding window)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to MAX_REQUESTS calls in the window", () => {
    for (let i = 0; i < MAX_REQUESTS; i++) {
      expect(checkRateLimit("rate-user").allowed).toBe(true);
    }
    expect(checkRateLimit("rate-user").allowed).toBe(false);
  });

  it("different users have independent windows", () => {
    for (let i = 0; i < MAX_REQUESTS + 2; i++) {
      checkRateLimit("busy-user");
    }
    expect(checkRateLimit("fresh-user").allowed).toBe(true);
  });

  it("resets after the window has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T00:00:00Z"));
    for (let i = 0; i < MAX_REQUESTS; i++) {
      checkRateLimit("expire-user");
    }
    expect(checkRateLimit("expire-user").allowed).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect(checkRateLimit("expire-user").allowed).toBe(true);
  });

  it("reports retryAfter seconds on denial", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T00:00:00Z"));
    for (let i = 0; i < MAX_REQUESTS; i++) {
      checkRateLimit("retry-user");
    }
    const result = checkRateLimit("retry-user");
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it("honours a stricter per-caller window/limit override", () => {
    // Login uses a tighter policy than the default limiter.
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit("login-override", 15 * 60_000, 3).allowed).toBe(true);
    }
    expect(checkRateLimit("login-override", 15 * 60_000, 3).allowed).toBe(false);
  });

  it("keeps an overridden bucket separate from the default policy", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit("shared-key", 15 * 60_000, 5);
    }
    // Same key, default policy: it gets its own window, not the exhausted one.
    expect(checkRateLimit("shared-key").allowed).toBe(true);
  });
});

describe("getClientIp", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost/api/auth/login", { headers });

  it("takes the right-most forwarded hop so a forged prefix cannot win", () => {
    // "1.1.1.1, 2.2.2.2" => the client claims 1.1.1.1, the proxy appended 2.2.2.2.
    expect(getClientIp(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("2.2.2.2");
  });

  it("skips private hops when picking the client address", () => {
    expect(getClientIp(req({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
  });

  it("never lets a rotating fake header mint a fresh bucket", () => {
    const a = getClientIp(req({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" }));
    const b = getClientIp(req({ "x-forwarded-for": "8.8.8.8, 203.0.113.7" }));
    expect(a).toBe(b);
  });

  it("rejects malformed IPv4 octets", () => {
    expect(getClientIp(req({ "x-forwarded-for": "999.1.1.1, 198.51.100.4" }))).toBe("198.51.100.4");
  });

  it("falls back to a single shared bucket when no usable IP exists", () => {
    expect(getClientIp(req({ "x-forwarded-for": "not-an-ip" }))).toBe("unknown");
    expect(getClientIp(req({}))).toBe("unknown");
    expect(getClientIp(req({ "x-forwarded-for": "127.0.0.1" }))).toBe("unknown");
  });

  it("accepts a public IPv6 client", () => {
    expect(getClientIp(req({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it("rejects loopback and unique-local IPv6", () => {
    expect(getClientIp(req({ "x-forwarded-for": "::1, fd00::1" }))).toBe("unknown");
  });

  it("uses x-real-ip when no forwarded chain is present", () => {
    expect(getClientIp(req({ "x-real-ip": "198.51.100.22" }))).toBe("198.51.100.22");
  });
});
