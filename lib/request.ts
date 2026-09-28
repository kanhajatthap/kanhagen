/**
 * Client IP extraction for rate limiting.
 *
 * `x-forwarded-for` is append-only: proxies add the peer they saw, so the
 * right-most entry is the one written by infrastructure closest to this
 * process, while the left-most entries are whatever the client sent. Taking
 * the left-most value (the old behaviour) let a caller mint a fresh bucket per
 * request by rotating a fake header. We walk from the right and skip entries
 * that aren't real, public IP literals, so a forged tail can't win.
 */

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function isPublicIPv4(value: string): boolean {
  if (!IPV4.test(value)) return false;
  const octets = value.split(".").map((n) => Number(n));
  if (octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a >= 224) return false; // multicast + reserved
  return true;
}

function isPublicIPv6(value: string): boolean {
  const v = value.toLowerCase();
  if (!v.includes(":")) return false;
  if (v === "::1" || v === "::") return false;
  if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return false;
  // Unique-local fc00::/7 and link-local fe80::/10 are covered above.
  return true;
}

function isPublicIP(value: string): boolean {
  return isPublicIPv4(value) ? true : isPublicIPv6(value);
}

/**
 * Best-effort client IP. Falls back to a single shared bucket key rather than
 * trusting a spoofable header, so an unknown environment fails closed.
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((h) => h.trim()).filter(Boolean);
    for (let i = hops.length - 1; i >= 0; i--) {
      const candidate = hops[i].replace(/^\[|\]$/g, "");
      if (isPublicIP(candidate)) return candidate;
    }
  }

  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp && isPublicIP(realIp)) return realIp;

  const vercelIp = req.headers.get("x-vercel-forwarded-for")?.trim();
  if (vercelIp && isPublicIP(vercelIp)) return vercelIp;

  return "unknown";
}
