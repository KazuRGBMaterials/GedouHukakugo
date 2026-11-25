/**
 * Pure drawing port for transparent 5-layer sprite sheets.
 * Image transport and asset resolution are injected; no battle / FIELD knowledge.
 */
export const DIRECTIONS = Object.freeze(["S","SE","E","NE","N","NW","W","SW"]);
export const LAYERS = Object.freeze(["skin","eyes","clothes","hair","accessories"]);
export function createLayeredCanvas({
  imageFactory = () => new Image(),
  assetUrl = src => src,
  onAssetReady = () => {}
} = {}) {
  const images = new Map();
  function getImage(src) {
    const url = assetUrl(src);
    if (!images.has(url)) {
      const image = imageFactory();
      image.onload = () => onAssetReady();
      image.onerror = () => onAssetReady();
      images.set(url, image);
      image.src = url;
    }
    return images.get(url);
  }
  function draw(ctx, graphics, facing, x, y, w, h) {
    if (graphics?.mode !== "layered" || !graphics.layers) return false;
    const rows = [...new Set([...(graphics.order || LAYERS), ...Object.keys(graphics.layers)])];
    const parts = rows.map(name => {
      const layer = graphics.layers[name];
      const src = typeof layer === "string" ? layer : layer?.src;
      return src ? { image: getImage(src), layer } : null;
    }).filter(Boolean);
    if (!parts.length || !parts.every(p => p.image.complete && p.image.naturalWidth > 0)) return false;
    const direction = typeof facing === "string"
      ? Math.max(0,DIRECTIONS.indexOf(facing)) : ((Math.trunc(facing)||0)%8+8)%8;
    const frame = graphics.directionFrames?.[direction] ?? direction;
    const fw = graphics.width || 30, fh = graphics.height || 42;
    const columns = graphics.columns || 4;
    const sx = frame % columns * fw, sy = Math.floor(frame/columns) * fh;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (const {image,layer} of parts) {
      ctx.globalAlpha = typeof layer === "object" && Number.isFinite(layer.opacity)
        ? Math.min(1,Math.max(0,layer.opacity)) : 1;
      ctx.drawImage(image,sx,sy,fw,fh,x,y,w,h);
    }
    ctx.restore();
    return true;
  }
  /**
   * Draw an independently translated region from the SAME frame in every
   * transparent layer. Used for 3-step articulated walk sprites without
   * introducing a separate character sheet or changing layer order.
   *
   * source: native frame-local pixel rectangle (e.g. 0,30,20,26)
   * destination: world-coordinate rectangle.
   * No caller-specific animation logic is built into this generic renderer.
   */
  function drawSegment(ctx, graphics, facing, source, destination) {
    if (graphics?.mode !== "layered" || !graphics.layers || !source || !destination) return false;
    const width = graphics.width || 30, height = graphics.height || 42;
    if (![source.x,source.y,source.w,source.h,
          destination.x,destination.y,destination.w,destination.h].every(Number.isFinite)) return false;
    if (source.x < 0 || source.y < 0 || source.w <= 0 || source.h <= 0 ||
        source.x + source.w > width || source.y + source.h > height ||
        destination.w <= 0 || destination.h <= 0) return false;
    const layers = [...new Set([...(graphics.order || LAYERS), ...Object.keys(graphics.layers)])];
    const parts = layers.map(name => {
      const layer = graphics.layers[name];
      const src = typeof layer === "string" ? layer : layer?.src;
      return src ? {image:getImage(src),layer} : null;
    }).filter(Boolean);
    if (!parts.length || !parts.every(part => part.image.complete && part.image.naturalWidth > 0)) return false;
    const direction = typeof facing === "string"
      ? Math.max(0,DIRECTIONS.indexOf(facing)) : ((Math.trunc(facing)||0)%8+8)%8;
    const frame = graphics.directionFrames?.[direction] ?? direction;
    const columns = graphics.columns || 4;
    const sx = (frame % columns) * width + source.x;
    const sy = Math.floor(frame / columns) * height + source.y;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (const {image,layer} of parts) {
      ctx.globalAlpha = typeof layer === "object" && Number.isFinite(layer.opacity)
        ? Math.min(1,Math.max(0,layer.opacity)) : 1;
      ctx.drawImage(image,sx,sy,source.w,source.h,
        destination.x,destination.y,destination.w,destination.h);
    }
    ctx.restore();
    return true;
  }
  return Object.freeze({draw,drawSegment,load:getImage});
}
