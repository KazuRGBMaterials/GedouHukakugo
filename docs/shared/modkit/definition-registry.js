/**
 * Content registry (no DOM, game rules, or network dependency).
 * One file may export one {kind,id,...} definition or any combination of
 * {characters:[], enemies:[], maps:[], objects:[]}. Loading files is the caller's job.
 */
export const CONTENT_KINDS = Object.freeze(["characters", "enemies", "maps", "objects"]);
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const forbidden = new Set(["__proto__", "prototype", "constructor"]);

function merge(base, patch) {
  if (!record(base) || !record(patch)) return Array.isArray(patch) ? patch.map(x => merge({}, x)) : patch;
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (forbidden.has(key)) throw new Error("Unsafe definition key: " + key);
    result[key] = record(value) && record(base[key]) ? merge(base[key], value) :
      Array.isArray(value) ? value.map(x => record(x) ? merge({}, x) : x) : value;
  }
  return result;
}

function deepFreeze(value) {
  if (record(value) || Array.isArray(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export function createDefinitionRegistry({ bases = {}, packs = [] } = {}) {
  const collections = Object.fromEntries(CONTENT_KINDS.map(kind => [kind, new Map()]));
  let sealed = false;

  function registerOne(kind, definition) {
    if (sealed) throw new Error("Definition registry has been sealed");
    if (!CONTENT_KINDS.includes(kind) || !record(definition)) throw new Error("Invalid content definition");
    const id = definition.id;
    if (typeof id !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(id))
      throw new Error("Invalid " + kind + " id: " + id);
    if (collections[kind].has(id)) throw new Error("Duplicate " + kind + " id: " + id);
    const output = merge(bases[kind] || {}, definition);
    delete output.kind;
    collections[kind].set(id, deepFreeze(output));
  }

  function register(pack) {
    if (Array.isArray(pack)) { pack.forEach(register); return; }
    if (!record(pack)) throw new Error("Pack must be an object or array");
    if (pack.kind && pack.id) {
      registerOne(pack.kind, pack);
      return;
    }
    let found = false;
    for (const kind of CONTENT_KINDS) {
      if (!Object.hasOwn(pack, kind)) continue;
      if (!Array.isArray(pack[kind])) throw new Error(kind + " must be an array");
      pack[kind].forEach(definition => registerOne(kind, definition));
      found = true;
    }
    if (!found) throw new Error("Pack contains no definitions");
  }

  packs.forEach(register);
  return Object.freeze({
    get(kind, id) { return collections[kind]?.get(id) ?? null; },
    list(kind) { return Object.freeze([...(collections[kind]?.values() ?? [])]); },
    has(kind, id) { return collections[kind]?.has(id) ?? false; },
    register,
    seal() { sealed = true; }
  });
}
