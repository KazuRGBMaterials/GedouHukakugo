/**
 * Composition root for battle content. Only this module imports concrete packs.
 * Replace/inject packs, registry factory, or terrain provider in isolation.
 */
import { createDefinitionRegistry } from "../modkit/definition-registry.js";
import { contentBases } from "./base.js";
import mage from "./characters/mage.js";
import hellor from "./characters/hellor.js";
import trainingEnemies from "./enemies/training-pack.js";
import terrainMaps from "./maps/terrain-pack.js";

export const DEFAULT_PACKS = Object.freeze([mage, hellor, trainingEnemies, terrainMaps]);

export function createBattleContent({
  packs = DEFAULT_PACKS,
  registryFactory = createDefinitionRegistry,
  terrainProvider = (_x, _y) => "grass"
} = {}) {
  const registry = registryFactory({ bases: contentBases, packs });
  registry.seal();
  // Arrow functions remain valid even when injected without an object receiver.
  const enemyFor = id => registry.get("enemies", id) || registry.get("enemies", "default");
  const mapFor = id => registry.get("maps", id) || registry.get("maps", "mixed");
  const terrainFor = (x, y, scene) => terrainProvider(x, y, mapFor(scene)?.terrainType || "mixed");
  const visualFor = (side, battle) => {
    const selected = battle?.grid?.characterBySide?.[side];
    const enemy = side.startsWith("enemy");
    const characterId = selected || (enemy
      ? enemyFor(battle?.grid?.enemyType)?.characterId : "mage");
    return registry.get("characters", characterId)?.graphics || null;
  };
  return Object.freeze({ registry, enemyFor, mapFor, terrainFor, visualFor });
}
