import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  UploadError,
  assertBodySizeWithinLimit,
  readUploadedImage,
  sanitizeHistory,
} from "../lib/chat/common";
import { buildVariations, MAX_VARIATIONS } from "../lib/providers";
import { imageMimeFromBase64, safeResponseImageMime } from "../lib/imageMime";

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP_HEADER = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP", "ascii"),
  Buffer.from([0, 0, 0, 0]),
]);

function file(bytes: Buffer, type: string): File {
  return new File([new Uint8Array(bytes)], "upload", { type });
}

describe("assertBodySizeWithinLimit", () => {
  it("rejects a declared Content-Length over the cap before buffering", () => {
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-length": String(MAX_UPLOAD_BYTES + 1) },
    });
    expect(() => assertBodySizeWithinLimit(req)).toThrow(UploadError);
  });

  it("returns 413 for an oversized declared body", () => {
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-length": String(MAX_UPLOAD_BYTES * 4) },
    });
    try {
      assertBodySizeWithinLimit(req);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UploadError);
      expect((e as UploadError).status).toBe(413);
    }
  });

  it("accepts a body under the cap", () => {
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-length": "1024" },
    });
    expect(() => assertBodySizeWithinLimit(req)).not.toThrow();
  });

  it("does not fatal on a missing or bogus Content-Length", () => {
    const missing = new Request("http://localhost/api/chat", { method: "POST" });
    expect(() => assertBodySizeWithinLimit(missing)).not.toThrow();
    const bogus = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-length": "not-a-number" },
    });
    expect(() => assertBodySizeWithinLimit(bogus)).not.toThrow();
  });
});

describe("readUploadedImage", () => {
  it("rejects a missing file", async () => {
    await expect(readUploadedImage(null)).rejects.toBeInstanceOf(UploadError);
  });

  it("rejects a disallowed declared type", async () => {
    await expect(readUploadedImage(file(PNG_HEADER, "image/gif"))).rejects.toThrow(/JPG, PNG, or WEBP/);
  });

  it("rejects an empty file", async () => {
    await expect(readUploadedImage(file(Buffer.alloc(0), "image/png"))).rejects.toThrow(/empty/);
  });

  it("rejects a file whose real bytes exceed the cap", async () => {
    // A lying client: declared size is fine, the buffer is not.
    const big = file(PNG_HEADER, "image/png");
    Object.defineProperty(big, "size", { value: 10 });
    await expect(readUploadedImage(big, 4)).rejects.toThrow(/too large/i);
  });

  it("reports 413 for an oversized upload", async () => {
    try {
      await readUploadedImage(file(PNG_HEADER, "image/png"), 4);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as UploadError).status).toBe(413);
    }
  });

  it("sniffs PNG bytes even when declared as jpeg", async () => {
    const res = await readUploadedImage(file(PNG_HEADER, "image/jpeg"));
    expect(res.mimeType).toBe("image/png");
  });

  it("sniffs JPEG and WEBP bytes", async () => {
    expect((await readUploadedImage(file(JPEG_HEADER, "image/png"))).mimeType).toBe("image/jpeg");
    expect((await readUploadedImage(file(WEBP_HEADER, "image/png"))).mimeType).toBe("image/webp");
  });

  it("rejects a renamed script that only claims to be a PNG", async () => {
    // A PHP/shell payload declared image/png must not reach the vision provider.
    const fake = file(Buffer.from("<?php system($_GET[0]); ?>", "ascii"), "image/png");
    await expect(readUploadedImage(fake)).rejects.toThrow(/not a valid/);
  });

  it("rejects arbitrary bytes declared as an allowed type", async () => {
    const fake = file(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]), "image/jpeg");
    await expect(readUploadedImage(fake)).rejects.toBeInstanceOf(UploadError);
  });
});

describe("sanitizeHistory", () => {
  it("keeps only well-formed user/assistant turns", () => {
    const out = sanitizeHistory([
      { role: "user", content: " hi " },
      { role: "system", content: "ignore" },
      { role: "assistant", content: "hello" },
      { role: "user", content: 123 },
      null,
    ]);
    expect(out).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("caps the number of messages", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ role: "user" as const, content: `m${i}` }));
    expect(sanitizeHistory(many).length).toBe(30);
  });

  it("returns an empty list for non-array input", () => {
    expect(sanitizeHistory(undefined)).toEqual([]);
    expect(sanitizeHistory("nope")).toEqual([]);
  });
});

describe("imageMime (Content-Type trust boundary)", () => {
  it("rejects a dangerous declared type at the sink", () => {
    // The XSS vector: a row stored as text/html must never be served as HTML.
    expect(safeResponseImageMime("text/html")).toBe("image/png");
    expect(safeResponseImageMime("image/svg+xml")).toBe("image/png");
    expect(safeResponseImageMime("application/xhtml+xml")).toBe("image/png");
    expect(safeResponseImageMime("text/html; charset=utf-8")).toBe("image/png");
  });

  it("rejects non-string and exotic values", () => {
    expect(safeResponseImageMime(undefined)).toBe("image/png");
    expect(safeResponseImageMime(null)).toBe("image/png");
    expect(safeResponseImageMime(42)).toBe("image/png");
    expect(safeResponseImageMime({ type: "image/png" })).toBe("image/png");
    expect(safeResponseImageMime("")).toBe("image/png");
  });

  it("passes real image types through unchanged", () => {
    for (const mime of ["image/png", "image/jpeg", "image/webp"]) {
      expect(safeResponseImageMime(mime)).toBe(mime);
    }
  });

  it("derives the type from bytes, ignoring the claimed one", () => {
    // A PHP payload base64'd and declared image/png derives to the safe default.
    expect(imageMimeFromBase64(Buffer.from("<script>alert(1)</script>").toString("base64"))).toBe("image/png");
    expect(imageMimeFromBase64(PNG_HEADER.toString("base64"))).toBe("image/png");
    expect(imageMimeFromBase64(JPEG_HEADER.toString("base64"))).toBe("image/jpeg");
    expect(imageMimeFromBase64(WEBP_HEADER.toString("base64"))).toBe("image/webp");
  });

  it("an HTML document can never round-trip to an HTML mime type", () => {
    const html = Buffer.from("<html><script>fetch('/api/history')</script></html>").toString("base64");
    expect(safeResponseImageMime(imageMimeFromBase64(html))).toBe("image/png");
  });

  it("sniffs an SVG (script-capable) as non-image, not as svg", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>').toString("base64");
    expect(safeResponseImageMime(imageMimeFromBase64(svg))).toBe("image/png");
  });
});

describe("buildVariations", () => {
  const base = { originalImageUrl: "https://example.com/a.png", prompt: "a cat", width: 1024, height: 1024, model: "flux" };

  it("clamps the count to the hard cap", () => {
    expect(buildVariations({ ...base, count: 100 })).toHaveLength(MAX_VARIATIONS);
  });

  it("never returns fewer than one", () => {
    expect(buildVariations({ ...base, count: 0 })).toHaveLength(1);
    expect(buildVariations({ ...base, count: -5 })).toHaveLength(1);
  });

  it("requests private upstream images", () => {
    for (const v of buildVariations({ ...base, count: 3 })) {
      expect(v.url).toContain("private=true");
    }
  });

  it("gives every variation a distinct seed", () => {
    const seeds = buildVariations({ ...base, count: 4 }).map((v) => v.seed);
    expect(new Set(seeds).size).toBe(4);
  });
});
