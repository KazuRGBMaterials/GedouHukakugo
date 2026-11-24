/**
 * Canvas-independent five-layer sprite adapter.
 * No imports from battle rules, characters, AI, maps, or storage.
 * All layers share direction, frame time, size and transform from their parent.
 */
export const DEFAULT_LAYER_ORDER = Object.freeze(["skin", "eyes", "clothes", "hair", "accessories"]);

export function createLayeredSpriteRenderer({
  createElement = tag => document.createElement(tag)
} = {}) {
  const state = new WeakMap();
  const positive = (v, fallback) => Number.isInteger(v) && v > 0 ? v : fallback;

  function reset(sprite) {
    sprite.classList.remove("is-layered");
    sprite.replaceChildren();
    sprite.style.width = "";
    sprite.style.height = "";
    sprite.style.backgroundImage = "";
    state.delete(sprite);
  }

  function prepare(sprite, graphics) {
    if (graphics?.mode !== "layered") {
      if (state.has(sprite)) reset(sprite);
      return false;
    }
    if (state.get(sprite)?.graphics === graphics) return true;
    if (!graphics.layers || typeof graphics.layers !== "object" || Array.isArray(graphics.layers))
      throw new Error("Layered graphics must define a layers object");
    const width = positive(graphics.width, 30), height = positive(graphics.height, 42);
    const columns = positive(graphics.columns, 4), rows = positive(graphics.rows, 2);
    const order = [...new Set([...(graphics.order || DEFAULT_LAYER_ORDER), ...Object.keys(graphics.layers)])];
    sprite.replaceChildren();
    sprite.classList.add("is-layered");
    sprite.style.width = width + "px";
    sprite.style.height = height + "px";
    sprite.style.backgroundImage = "none";

    const parts = [];
    for (const name of order) {
      const source = graphics.layers[name];
      const src = typeof source === "string" ? source : source?.src;
      const part = createElement("span");
      part.className = "sprite-part";
      part.dataset.layer = name;
      if (src) {
        // Authored content paths, not untrusted user input or HTML.
        part.style.backgroundImage = 'url("' + String(src).replaceAll('"', "%22") + '")';
      }
      part.style.backgroundSize = (width * columns) + "px " + (height * rows) + "px";
      part.style.opacity = String(typeof source === "object" && source.opacity !== undefined
        ? source.opacity : 1);
      sprite.append(part);
      parts.push(part);
    }
    state.set(sprite, { graphics, width, height, columns, rows, parts });
    return true;
  }

  function face(sprite, graphics, direction) {
    if (!prepare(sprite, graphics)) return false;
    const current = state.get(sprite);
    const safe = ((Math.trunc(direction) || 0) % 8 + 8) % 8;
    const frame = graphics.directionFrames?.[safe] ?? safe;
    const x = (frame % current.columns) * current.width;
    const y = Math.floor(frame / current.columns) * current.height;
    for (const part of current.parts) {
      part.style.backgroundPosition = `${-x}px ${-y}px`;
    }
    return true;
  }

  return Object.freeze({ prepare, face, reset });
}
