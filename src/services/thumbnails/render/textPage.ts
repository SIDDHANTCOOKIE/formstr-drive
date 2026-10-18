import { encodeCanvas } from "../encode";
import { THUMB_MAX } from "../limits";

const PAD = 14;
/** Characters considered per line; anything longer is clipped before measuring. */
const MAX_LINE_CHARS = 400;

/** Longest prefix of text that fits maxWidth, found by binary search (log n measureText calls). */
function clipToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  const line = text.length > MAX_LINE_CHARS ? text.slice(0, MAX_LINE_CHARS) : text;
  if (ctx.measureText(line).width <= maxWidth) return line;
  let lo = 0;
  let hi = line.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(line.slice(0, mid)).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return line.slice(0, lo);
}

/** Paper-coloured square with the given lines of text: the thumbnail for documents and code. */
export async function drawTextPage(lines: string[], options: { monospace: boolean }): Promise<Uint8Array> {
  const { monospace } = options;
  const fontSize = monospace ? 10 : 12;
  const lineHeight = Math.round(fontSize * 1.45);

  const canvas = document.createElement("canvas");
  canvas.width = THUMB_MAX;
  canvas.height = THUMB_MAX;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, THUMB_MAX, THUMB_MAX);
  ctx.fillStyle = "#1f2937";
  ctx.textBaseline = "top";
  ctx.font = `${fontSize}px ${monospace ? "ui-monospace, Menlo, Consolas, monospace" : "system-ui, sans-serif"}`;

  const maxLines = Math.floor((THUMB_MAX - PAD * 2) / lineHeight);
  const maxWidth = THUMB_MAX - PAD * 2;
  lines.slice(0, maxLines).forEach((line, i) => {
    ctx.fillText(clipToWidth(ctx, line.replace(/\t/g, "  "), maxWidth), PAD, PAD + i * lineHeight);
  });
  return encodeCanvas(canvas);
}
