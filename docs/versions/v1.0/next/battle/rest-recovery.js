/**
 * Opt-in NEXT battle rule decorator: waiting for one complete belt slot
 * restores 2 HP only if the combatant takes no damage in that slot.
 * Does not alter the original shared VER4 rules, stamina or hit resolution.
 *
 * The original advance and grid side resolver are injected at composition.
 */
export const WAIT_HEAL_HP = 2;
export function withWaitHealthRecovery(advanceCore, {
  sidesForBattle = battle => battle.grid ? ["player","ally","ally2","ally3","enemy","enemy2","enemy3","enemy4"] : ["player","enemy"],
  healHp = WAIT_HEAL_HP
} = {}) {
  if (typeof advanceCore !== "function") throw new TypeError("Battle core advance is required");
  if (!Number.isInteger(healHp) || healHp < 0) throw new RangeError("Heal must be a nonnegative integer");
  return function advanceWithRestRecovery(battle) {
    if (battle.phase !== "running") return;
    const tick=battle.tick+1;
    const candidates=sidesForBattle(battle).map(side=>{
      const actor=battle[side];
      if (!actor || actor.hp <= 0) return null;
      const wait=actor.actions.find(action=>action.commandId==="wait"
        && action.status==="pending" && action.start<=tick && action.impact===tick);
      return wait ? {side, wait, hp:actor.hp} : null;
    }).filter(Boolean);
    advanceCore(battle);
    if (battle.tick !== tick) return;
    for (const {side,wait,hp} of candidates){
      const actor=battle[side];
      // Completed wait, still alive, no HP damage in that slot.
      if(!actor || actor.hp<=0 || actor.hp!==hp || wait.status!=="resolved")continue;
      const recovered=Math.min(healHp,Math.max(0,actor.maxHp-actor.hp));
      if (recovered===0)continue;
      actor.hp+=recovered;
      const label=side==="player"?"MAGE":side.startsWith("ally")?"味方":side.startsWith("enemy")?"敵":"戦闘者";
      if (Array.isArray(battle.events)){
        battle.events.unshift(`${label}は待機でHPを${recovered}回復。`);
        battle.events.length=Math.min(9,battle.events.length);
      }
    }
  };
}
