/**
 * One manifest/composition root for vNext FIELD, BATTLE, EDITOR.
 * Individual modules and multi-entry packs share the same registry API.
 */
import { createBattleContent, DEFAULT_PACKS } from "../../battle/content/manifest.js";
import { terrainAt } from "../../battle/grid-terrain.js";
import mageNext from "./characters/mage-next.js?v=6";
import nameless from "./characters/nameless.js";
import namelessEnemy from "./enemies/nameless.js";
import starterMap from "./maps/starter-map.js";
import objectPack from "./objects/library-pack.js";

export const NEXT_PACKS = Object.freeze([...DEFAULT_PACKS,mageNext,nameless,namelessEnemy,starterMap,objectPack]);
export function createNextContent({packs = NEXT_PACKS, terrainProvider = terrainAt} = {}) {
  return createBattleContent({packs,terrainProvider});
}
export const nextContent = createNextContent();

export function graphicsForBattle(side, battle, content = nextContent) {
  const selected = battle?.grid?.characterBySide?.[side];
  if (selected) return content.registry.get("characters",selected)?.graphics || null;
  // The next generation defaults to layered characters on the allied team.
  if (!side.startsWith("enemy")) return content.registry.get("characters","mage-next")?.graphics;
  return content.registry.get("characters",battle?.grid?.enemyDefinitionId || "nameless")?.graphics
    || content.visualFor(side,battle);
}

export function fieldMapFor(id, content=nextContent) {
  const def = content.registry.get("maps",id);
  return def?.file || null;
}
export function objectDefinitionFor(id,content=nextContent){
  return content.registry.get("objects",id)
    || content.registry.list("objects").find(object => object.fieldType === id) || null;
}
