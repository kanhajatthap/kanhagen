/**
 * Image content-type handling.
 *
 * The MIME type of an image must never be trusted from the client or from an
 * upstream provider — both are attacker-influenceable. `POST /api/history`
 * accepts a `mimeType` field verbatim, and a compromised/hostile provider can
 * return an arbitrary `content-type` header. If that value is later echoed in
 * a `Content-Type` response header, a browser will happily parse a
 * `text/html` body as a document on our own origin — a stored XSS.
 *
 * So the type is always *derived from the bytes* and passed through a strict
 * allowlist at both ends: validated on write, and re-checked at the sink.
 */

export const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/** What we serve when the bytes don't match any known image format. */
export const FALLBACK_IMAGE_MIME = "image/png";

/** Magic-number check so a .txt renamed to .png can't be treated as an image. */
export function sniffImageMime(buffer: Buffer): string | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * The only MIME type safe to put in a `Content-Type` response header for a
 * stored image: never `text/html` or `image/svg+xml`, both of which execute
 * script in a top-level navigation context.
 */
export function safeResponseImageMime(mimeType: unknown): string {
  return typeof mimeType === "string" && ALLOWED_IMAGE_MIME.has(mimeType)
    ? mimeType
    : FALLBACK_IMAGE_MIME;
}

/**
 * Derive the stored MIME type from the actual image bytes, ignoring whatever
 * the client or provider claimed. Falls back to PNG when the bytes are not a
 * recognisable image — the sink re-validates regardless, so a bad guess can
 * never become script execution.
 */
export function deriveImageMime(bytes: Buffer): string {
  return sniffImageMime(bytes) ?? FALLBACK_IMAGE_MIME;
}

/** Decodes a base64 payload and derives its real MIME type in one step. */
export function imageMimeFromBase64(base64: string): string {
  const bytes = Buffer.from(base64, "base64");
  return bytes.length > 0 ? deriveImageMime(bytes) : FALLBACK_IMAGE_MIME;
}
