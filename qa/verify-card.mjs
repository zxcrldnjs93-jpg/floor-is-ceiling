// Runs in the verification tab. Link the drawing operations to the encoded blob used by Save.
export function watchCardPng() {
  const art = window.LandingArt;
  if (typeof art?.drawCard !== 'function') throw new Error('카드 PNG 그리기 훅이 없습니다.');
  const cards = new WeakMap();
  const masks = new WeakMap();
  const pngs = new WeakMap();
  const cardUrls = new Map();
  const draw = art.drawCard;
  const context = CanvasRenderingContext2D.prototype;
  const { fillText, getImageData } = context;
  const { toBlob } = HTMLCanvasElement.prototype;
  const { createObjectURL } = URL;
  let ledCard, saved;

  art.drawCard = function (canvas, ...args) {
    cards.set(canvas, { led: null, mini: null, textDraw: [] });
    return draw.call(this, canvas, ...args);
  };
  context.fillText = function (text, ...args) {
    const card = cards.get(this.canvas);
    if (card) {
      card.textDraw.push({ text: String(text), x: args[0], y: args[1] });
      if (text === '최대 쿵') ledCard = card;
      const label = /^최대\s+([\d,]+)$/.exec(text);
      if (label) card.mini = Number(label[1].replaceAll(',', ''));
    } else if (ledCard && /^\d+$/.test(text)) {
      masks.set(this.canvas, { card: ledCard, number: Number(text) });
    }
    return fillText.call(this, text, ...args);
  };
  context.getImageData = function (...args) {
    const pixels = getImageData.apply(this, args);
    const mask = masks.get(this.canvas);
    if (mask && mask.card === ledCard) {
      ledCard.led = mask.number;
      ledCard = null;
    }
    return pixels;
  };
  HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
    const card = cards.get(this);
    if (!card) return toBlob.call(this, callback, ...args);
    return toBlob.call(this, (blob) => {
      if (blob) {
        const rows = new Set(card.textDraw.filter(({ text }) => /절반 높이|매트(?: 위에선)?/.test(text)).map(({ y }) => y));
        pngs.set(blob, { led: card.led, mini: card.mini, textDraw: card.textDraw, matDraw: card.textDraw.filter(({ y }) => rows.has(y)) });
      }
      callback(blob);
    }, ...args);
  };
  URL.createObjectURL = function (blob) {
    const url = createObjectURL.call(this, blob);
    if (pngs.has(blob)) {
      saved = { ...pngs.get(blob), blob };
      cardUrls.set(url, saved);
    }
    return url;
  };
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[download]');
    const card = link && cardUrls.get(link.href);
    if (card) {
      card.filename = link.download;
      cardUrls.delete(link.href);
    }
  }, { capture: true });

  return async () => {
    if (!saved) return null;
    const { blob, led, mini, textDraw, matDraw, filename } = saved;
    const bytes = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
    const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
    const png = blob.type === 'image/png' && bytes.length === 24 && signature.every((byte, index) => byte === bytes[index]);
    const dimensions = new DataView(bytes.buffer);
    return { led, mini, textDraw, matDraw, filename, bytes: blob.size, width: png ? dimensions.getUint32(16) : null,
      height: png ? dimensions.getUint32(20) : null };
  };
}
