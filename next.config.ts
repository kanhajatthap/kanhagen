import type { NextConfig } from "next";

/**
 * Baseline security headers.
 *
 * The image endpoints serve user-supplied bytes from our own origin, so
 * `X-Content-Type-Options` matters most here: it stops a browser from ignoring
 * a safe Content-Type and sniffing the body back into `text/html`. The rest are
 * standard defence-in-depth.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next injects inline bootstrap/hydration scripts, so 'unsafe-inline' is
      // required for the app shell. Script from any other origin stays blocked.
      // React's dev build additionally needs eval() to rebuild call stacks;
      // production never calls it, so it's only allowed in development.
      `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${
        process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""
      }`,
      // Pollinations and the AI providers are fetched as images/data at runtime.
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https:",
      // The Turnstile challenge runs inside a cross-origin iframe; without this it
      // is blocked and the widget never renders.
      "frame-src 'self' https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      // Turnstile can spin up a worker from a blob URL; without this the
      // challenge silently stalls instead of failing loudly.
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
