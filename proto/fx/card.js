import { cardStyles, renderDesignCard } from "./card-design.js";
import { displayedPeak, TYPE_RULES } from "./type.js";

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;
const renderedCards = new WeakMap();

function markupText(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function publicDemoUrl(value) {
  try {
    const url = new URL(value ?? globalThis.document?.querySelector('link[rel="canonical"]')?.href);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
    url.hash = "";
    url.search = "";
    return url.href;
  } catch {
    return "";
  }
}

export function renderCard(canvas, result, { demoUrl, events = [] } = {}) {
  const document = canvas.ownerDocument ?? globalThis.document;
  const root = document.createElement("div");
  const marks = [];
  for (const event of events) {
    if (Number.isFinite(event?.x) && Number.isFinite(event.index) && event.index >= TYPE_RULES.eventMinIndex) {
      marks.push([Math.min(1, Math.max(0, event.x)), displayedPeak(event.index)]);
    }
  }
  const count = result.stats?.n;
  renderDesignCard(document, root, {
    variant: "peak",
    type: markupText(result.title),
    quip: markupText(result.copy),
    peak: displayedPeak(result.stats?.peak),
    n: Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
    events: marks,
    url: markupText(publicDemoUrl(demoUrl)),
    badge: markupText(result.badge),
    matLine: markupText(result.matLine),
  });
  if (result.matLine) {
    const slot = root.querySelector("[data-card-mat]");
    if (slot) {
      slot.textContent = result.matLine;
      slot.hidden = false;
    } else {
      const entry = root.querySelector(".tb > div:nth-child(2)");
      if (entry) {
        const line = document.createElement("span");
        line.textContent = result.matLine.replace("매트 위에선 쿵 ", "매트 ");
        entry.appendChild(line);
      }
    }
  }
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  renderedCards.set(canvas, root);
  return canvas;
}

async function rasterizeCard(canvas, root) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("카드 Canvas 2D를 열 수 없습니다.");
  const markup = new XMLSerializer().serializeToString(root);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}">
    <foreignObject width="100%" height="100%"><body xmlns="http://www.w3.org/1999/xhtml">
    <style>${markupText(cardStyles)}</style>${markup}</body></foreignObject></svg>`;
  const picture = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("카드 도면을 이미지로 열 수 없습니다."));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  if (renderedCards.get(canvas) !== root) throw new Error("결과 카드가 갱신되었습니다.");
  context.save();
  try {
    // Keep scene-owned overlays drawn after renderCard above the design artwork.
    context.globalCompositeOperation = "destination-over";
    context.drawImage(picture, 0, 0);
  } finally {
    context.restore();
  }
  if (context.getImageData(0, 0, 1, 1).data[3] === 0) {
    throw new Error("이 브라우저에서 카드 도면을 PNG에 그릴 수 없습니다.");
  }
}

export async function exportCardPng(canvas) {
  const root = renderedCards.get(canvas);
  if (root) await rasterizeCard(canvas, root);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("카드 PNG를 만들 수 없습니다."));
    }, "image/png");
  });
}

export function downloadCardPng(png, filename = "upstairs-type.png") {
  const document = globalThis.document;
  if (!png || !document?.body || typeof globalThis.URL?.createObjectURL !== "function") return false;
  let objectUrl;
  let anchor;
  try {
    objectUrl = URL.createObjectURL(png);
    anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    return true;
  } catch {
    return false;
  } finally {
    anchor?.remove();
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}

async function copyLink(url) {
  if (!url) return false;
  try {
    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard?.writeText) {
      await clipboard.writeText(url);
      return true;
    }
  } catch {
    // Try the text selection fallback when Clipboard is unavailable or denied.
  }

  const document = globalThis.document;
  if (!document?.body || typeof document.execCommand !== "function") return false;
  const focused = document.activeElement;
  let field;
  try {
    field = document.createElement("textarea");
    field.value = url;
    field.readOnly = true;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    field.setSelectionRange(0, url.length);
    return document.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    field?.remove();
    if (field && focused?.isConnected) focused.focus({ preventScroll: true });
  }
}

export function formatShareText(result, demoUrl) {
  const url = publicDemoUrl(demoUrl);
  if (!result?.title || !url) return "";
  const reduction = result.matLine ? result.stats?.matComparison?.reduction : null;
  const mat = Number.isFinite(reduction) && reduction >= 0 ? ` 매트를 깔았더니 쿵 지수가 ${Math.round(reduction * 100)}% 줄었다.` : "";
  return `나는 오늘 ${result.title} 위층이었다. 내 최대 쿵은 ${displayedPeak(result.stats?.peak)}.${mat} 아래층에서 들어 보니 이렇더라 → ${url}`;
}

export async function shareCard({ png, result, demoUrl, url, title = "중력을 뒤집으면", filename = "upstairs-type.png" } = {}) {
  const address = publicDemoUrl(demoUrl ?? url);
  const text = formatShareText(result, address);
  const message = text ? { title, text } : { title, url: address };
  const device = globalThis.navigator;
  const outcome = { downloaded: false, copied: false, url: address };
  if (address && typeof device?.share === "function") {
    if (png && typeof globalThis.File === "function") {
      try {
        const files = [new File([png], filename, { type: "image/png" })];
        if (!device.canShare || device.canShare({ files })) {
          await device.share({ ...message, files });
          return { status: "shared", ...outcome };
        }
      } catch (error) {
        if (error?.name === "AbortError") return { status: "cancelled", ...outcome };
      }
    }
    try {
      await device.share(message);
      return { status: "shared", ...outcome };
    } catch (error) {
      if (error?.name === "AbortError") return { status: "cancelled", ...outcome };
    }
  }

  const downloaded = downloadCardPng(png, filename);
  const copied = await copyLink(address);
  return { status: "fallback", downloaded, copied, url: address };
}
