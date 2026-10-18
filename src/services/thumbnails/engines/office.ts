import { imageBytesToThumbnail } from "../encode";
import { DOCX_RENDER_MAX_BYTES } from "../limits";
import { renderDocumentThumbnail } from "../render/document";
import { drawTextPage } from "../render/textPage";
import { openZip, type ZipReader } from "../zip";

const EMBEDDED_THUMBNAILS = [
  { path: "docProps/thumbnail.jpeg", mime: "image/jpeg" },
  { path: "docProps/thumbnail.jpg", mime: "image/jpeg" },
  { path: "docProps/thumbnail.png", mime: "image/png" },
  { path: "Thumbnails/thumbnail.png", mime: "image/png" }, // OpenDocument
];

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const TEXT_LINES = 14;
/** Unique class so a thumbnail render never collides with the styles of an open docx preview. */
const DOCX_CLASS = "thumbdocx";

/** The preview image the authoring app embedded in the archive, if any. */
async function embeddedThumbnail(zip: ZipReader): Promise<Uint8Array | null> {
  for (const { path, mime } of EMBEDDED_THUMBNAILS) {
    const bytes = await zip.read(path);
    if (!bytes?.length) continue;
    try {
      return await imageBytesToThumbnail(bytes, mime);
    } catch {
      // A corrupt embedded image should not stop the other fallbacks.
    }
  }
  return null;
}

/** Page 1 of a docx, laid out by docx-preview in an off-screen host and rasterized. */
async function renderFirstPage(file: File, signal: AbortSignal): Promise<Uint8Array> {
  const { renderAsync } = await import("docx-preview");
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;width:1600px;visibility:hidden;pointer-events:none";
  document.body.appendChild(host);
  try {
    await renderAsync(await file.arrayBuffer(), host, host, {
      className: DOCX_CLASS,
      inWrapper: false,
      breakPages: true,
      useBase64URL: true,
      renderHeaders: false,
      renderFooters: false,
      renderFootnotes: false,
      renderEndnotes: false,
    });
    signal.throwIfAborted();

    const page = host.querySelector<HTMLElement>(`section.${DOCX_CLASS}`);
    if (!page) throw new Error("Document has no pages");
    const styles = Array.from(host.querySelectorAll("style"), (s) => s.outerHTML).join("");
    return await renderDocumentThumbnail(`${styles}${page.outerHTML}`, Math.round(page.getBoundingClientRect().width) || 794, signal);
  } finally {
    host.remove();
  }
}

/** First paragraphs of a docx as a text page, for when rendering is unavailable. */
async function paragraphsPage(zip: ZipReader): Promise<Uint8Array | null> {
  const xml = await zip.read("word/document.xml");
  if (!xml) return null;
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(xml), "application/xml");
  const lines: string[] = [];
  for (const p of Array.from(doc.getElementsByTagNameNS(W_NS, "p"))) {
    const text = Array.from(p.getElementsByTagNameNS(W_NS, "t"), (t) => t.textContent ?? "").join("").trim();
    if (text) lines.push(text);
    if (lines.length >= TEXT_LINES) break;
  }
  return lines.length ? drawTextPage(lines, { monospace: false }) : null;
}

/**
 * docx/xlsx/pptx/odf. The embedded preview image wins; a docx without one is
 * rendered (when small enough), then reduced to its first paragraphs.
 */
export async function officeThumbnail(file: File, signal: AbortSignal): Promise<Uint8Array> {
  const zip = await openZip(file);
  if (!zip) throw new Error("Not a readable ZIP-based document");

  const embedded = await embeddedThumbnail(zip);
  if (embedded) return embedded;
  signal.throwIfAborted();

  if (zip.names.includes("word/document.xml")) {
    if (file.size <= DOCX_RENDER_MAX_BYTES) {
      try {
        return await renderFirstPage(file, signal);
      } catch (e) {
        if (signal.aborted) throw e;
        console.info("[thumb] docx render unavailable, using a text page:", e instanceof Error ? e.message : e);
      }
    }
    const page = await paragraphsPage(zip);
    if (page) return page;
  }
  throw new Error("No preview available for this document");
}
