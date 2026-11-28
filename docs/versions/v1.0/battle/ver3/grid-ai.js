import { distance, fireReaches, rangeStep } from "./grid-rules.js?v=6";

const defaults = { risk: "balanced", waste: "some", style: "power" };
const risks = ["bold", "balanced", "cautious"];
const wasteFrequency = { often: 3, some: 5, rarely: 0 };
const styles = ["power", "hitRun", "mage"];

export function makeEnemyProfile(selection = defaults) {
  return {
    risk: risks.includes(selection.risk) ? selection.risk : defaults.risk,
    waste: Object.hasOwn(wasteFrequency, selection.waste) ? selection.waste : defaults.waste,
    style: styles.includes(selection.style) ? selection.style : defaults.style
  };
}

export function chooseEnemyAction(view, canChoose) {
  const { profile, from, target, previous, turn, hp, stamina, incomingDamage, board } = view;
  const gap = distance(from, target);
  const safer = profile.risk === "cautious";
  const defend = safer || (profile.risk === "balanced" && (hp <= 50 || incomingDamage >= 24));
  if (incomingDamage && defend && canChoose("guard")) {
    return { id: "guard" };
  }
  if (safer && stamina <= 2) return { id: "wait" };

  const interval = wasteFrequency[profile.waste];
  if (interval && (turn + 1) % interval === 0 && !incomingDamage && stamina >= 2) {
    return { id: "wait" };
  }

  function step(sign) {
    const destination = rangeStep(from, target, sign, cell => canChoose("move", cell), board);
    if (destination) return { id: "move", destination };
    return null;
  }

  if (profile.style === "mage" && fireReaches(from, target, board)) {
    if (gap === 1 && profile.risk !== "bold") {
      const backingOff = step(1);
      if (backingOff) return backingOff;
    }
    if (canChoose("fire")) return { id: "fire" };
  }

  if (gap > 1) return step(-1) ?? { id: "wait" };

  if (profile.style === "hitRun" && previous === "quick") {
    const backingOff = step(1);
    if (backingOff) return backingOff;
  }
  const preferred = profile.style === "power" && previous !== "heavy" ? ["heavy", "quick"] : ["quick", "heavy"];
  return { id: preferred.find(id => canChoose(id)) ?? "wait" };
}
