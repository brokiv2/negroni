import sharp from "sharp";
import { fetchSafeWebText } from "./web-ssrf.js";

const cache = new Map<string, string>();
export async function rasterizeConnectorLogo(url: string, signal?: AbortSignal) {
  const cached = cache.get(url);
  if (cached) return cached;
  const { body } = await fetchSafeWebText(url, { signal, timeoutMs: 8_000, maxBytes: 1_048_576 });
  const png = await rasterizeConnectorSVG(body);
  if (cache.size >= 256) cache.delete(cache.keys().next().value!);
  cache.set(url, png);
  return png;
}
export async function rasterizeConnectorSVG(svg: string) {
  if (
    !/<svg[\s>]/i.test(svg) ||
    /<!DOCTYPE|<!ENTITY|<script|<foreignObject|(?:href|src)\s*=\s*["'](?!#)|url\(\s*["']?(?!#)/i.test(
      svg,
    )
  ) {
    throw new Error("Unsupported connector icon");
  }
  const png = await sharp(Buffer.from(svg), { limitInputPixels: 16_777_216 })
    .resize(96, 96, { fit: "inside" })
    .png()
    .toBuffer();
  return png.toString("base64");
}
