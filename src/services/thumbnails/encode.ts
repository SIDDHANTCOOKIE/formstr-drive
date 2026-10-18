import { canvasToBlobWithFallback } from "../../utils/canvas";
import { THUMB_MAX } from "./limits";

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

/** Fits (w, h) inside max x max, keeping the aspect ratio and never upscaling. */
export function fitWithin(width: number, height: number, max = THUMB_MAX): { width: number; height: number } {
  const scale = Math.min(max / width, max / height, 1);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Encoded bytes of a canvas: WebP where the browser can encode it, otherwise JPEG. */
export async function encodeCanvas(canvas: AnyCanvas, quality = 0.7): Promise<Uint8Array> {
  const blob = await canvasToBlobWithFallback(canvas, quality);
  return new Uint8Array(await blob.arrayBuffer());
}

/** Decodes encoded image bytes and scales them to a thumbnail. */
export async function imageBytesToThumbnail(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: mime }));
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
    return await encodeCanvas(canvas);
  } finally {
    bitmap.close();
  }
}
