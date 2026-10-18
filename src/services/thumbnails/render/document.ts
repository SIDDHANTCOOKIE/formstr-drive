// Rasterizes markup (an HTML page, or a docx page laid out by docx-preview) into
// a square thumbnail of the TOP of the page, the way a drive shows documents.
//
// The markup goes into an SVG <foreignObject> that is loaded as an image: the
// browser lays it out and paints it, but an SVG image runs no scripts and
// fetches no external resources, so untrusted HTML is safe to render here.
// External stylesheets, web fonts and remote images simply do not load.

import { encodeCanvas } from "../encode";
import { THUMB_MAX } from "../limits";

const ROOT = "thumb-doc-root";
const XHTML = "http://www.w3.org/1999/xhtml";
const LOAD_TIMEOUT_MS = 10_000;
const REMOVE = "script, link, iframe, frame, object, embed, base, meta, noscript, audio, video, source";

/**
 * Maps selectors that target the page itself (html, body, :root) onto the
 * wrapper element we render into. "html body" collapses to a single root.
 */
export function retargetSelector(selector: string): string {
  return selector
    .replace(/(^|[\s>+~,(])(?:html|body|:root)(?![\w-])/gi, `$1.${ROOT}`)
    .replace(new RegExp(`\\.${ROOT}(?:\\s*[>+~]?\\s*)\\.${ROOT}(?![\\w-])`, "g"), `.${ROOT}`);
}

function retargetRules(rules: CSSRuleList): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      rule.selectorText = retargetSelector(rule.selectorText);
    } else if ("cssRules" in rule) {
      retargetRules((rule as CSSGroupingRule).cssRules);
    }
  }
}

/** Author CSS with its page-level selectors retargeted, through the CSSOM rather than regex. */
function retargetedCss(source: string): string {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(source); // drops @import
    retargetRules(sheet.cssRules);
    return Array.from(sheet.cssRules)
      .map((rule) => rule.cssText)
      .join("\n");
  } catch {
    return ""; // renders unstyled rather than failing
  }
}

function styleElement(css: string): string {
  // CDATA keeps valid CSS containing < or & well-formed inside the XML document.
  return `<style xmlns="${XHTML}"><![CDATA[${css.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]></style>`;
}

function buildSvg(html: string, width: number): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll(REMOVE).forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith("on") || /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
    }
  });

  const styles = Array.from(doc.querySelectorAll("style")).map((s) => styleElement(retargetedCss(s.textContent ?? "")));
  doc.querySelectorAll("style").forEach((s) => s.remove());

  const root = doc.createElement("div");
  root.className = ROOT;
  root.setAttribute(
    "style",
    `width:${width}px;height:${width}px;overflow:hidden;box-sizing:border-box;${doc.body.getAttribute("style") ?? ""}`,
  );
  root.append(...Array.from(doc.body.childNodes));

  const defaults = styleElement(`.${ROOT}{background:#fff;color:#111;font-family:system-ui,sans-serif;margin:0}`);
  const markup = new XMLSerializer().serializeToString(root);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}">` +
    `<foreignObject width="100%" height="100%">${defaults}${styles.join("")}${markup}</foreignObject></svg>`
  );
}

function loadSvg(svg: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    signal.throwIfAborted();
    const img = new Image();
    const timer = setTimeout(() => finish(() => reject(new Error("Render timed out"))), LOAD_TIMEOUT_MS);
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      settle();
    };
    const onAbort = () => finish(() => reject(signal.reason));
    signal.addEventListener("abort", onAbort, { once: true });
    img.onload = () => finish(() => resolve(img));
    img.onerror = () => finish(() => reject(new Error("Markup could not be rendered as an image")));
    // A data: URL, not a blob: URL: Chromium taints canvases that drew a blob-URL foreignObject SVG.
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

let probe: Promise<boolean> | null = null;

/**
 * Safari taints a canvas that drew a foreignObject image, so exporting it
 * throws. Probe once with a 1x1 image so unsupported browsers skip the work.
 */
function canRasterizeMarkup(): Promise<boolean> {
  probe ??= (async () => {
    try {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><foreignObject width="2" height="2"><div xmlns="${XHTML}" style="width:2px;height:2px;background:red"></div></foreignObject></svg>`;
      const img = await loadSvg(svg, new AbortController().signal);
      const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      ctx.getImageData(0, 0, 1, 1);
      return true;
    } catch {
      return false;
    }
  })();
  return probe;
}

/** Renders html at width CSS pixels wide and returns a square thumbnail of its top width x width region. */
export async function renderDocumentThumbnail(html: string, width: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!(await canRasterizeMarkup())) throw new Error("This browser cannot export rendered markup");
  const img = await loadSvg(buildSvg(html, width), signal);

  const canvas = document.createElement("canvas");
  canvas.width = THUMB_MAX;
  canvas.height = THUMB_MAX;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, THUMB_MAX, THUMB_MAX);
  ctx.drawImage(img, 0, 0, THUMB_MAX, THUMB_MAX);
  return encodeCanvas(canvas);
}
