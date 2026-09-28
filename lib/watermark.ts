import sharp from "sharp";

const WATERMARK_TEXT = "KanhaGen";
const WATERMARK_OPACITY = 0.3;

export async function addWatermark(imageBuffer: Buffer): Promise<Buffer> {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    const width = metadata.width || 1024;
    const height = metadata.height || 1024;

    const fontSize = Math.max(16, Math.floor(width / 40));
    const padding = 20;

    const svgText = `
      <svg width="${width}" height="${height}">
        <style>
          .watermark {
            font-family: Arial, sans-serif;
            font-size: ${fontSize}px;
            fill: white;
            opacity: ${WATERMARK_OPACITY};
          }
        </style>
        <text x="${width - padding}" y="${height - padding}" 
              class="watermark" text-anchor="end" 
              style="filter: drop-shadow(1px 1px 1px rgba(0,0,0,0.5))">
          ${WATERMARK_TEXT}
        </text>
      </svg>
    `;

    const result = await sharp(imageBuffer)
      .composite([{ input: Buffer.from(svgText), top: 0, left: 0 }])
      .png()
      .toBuffer();

    return Buffer.from(result);
  } catch (error) {
    console.error("Watermark error:", error);
    return imageBuffer;
  }
}
