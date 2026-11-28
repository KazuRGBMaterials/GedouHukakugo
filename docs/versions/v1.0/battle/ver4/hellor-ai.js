import { distance, adjacent8, fireReaches, rangeStep } from "./grid-rules.js?v=7";

// Separate boss tactics: no hidden position knowledge and no altered damage/stamina rules.
// Hellor studies only already-queued actions and currently visible combat positions.
const pending = (unit, tick) => unit.actions?.find(a =>
  a.status === "pending" && a.start <= tick && tick <= a.end);
const aimed = (unit, at, from, board) => {
  const a = unit.actions?.find(row => row.status === "pending" && row.impact === at);
  if (!a || !["quick", "heavy", "fire", "jumpSlash"].includes(a.commandId)) return null;
  const inRange = a.commandId === "fire" ? fireReaches(unit.at, from, board)
    : a.commandId === "jumpSlash" ? distance(unit.at, from) <= 4
    : adjacent8(unit.at, from);
  return inRange ? a.commandId : null;
};

export function chooseHellorAction(view, canChoose) {
  const { board, from, opponents, previous, lockedTarget, turn, stamina, hp, nextStart } = view;
  const standing = opponents.filter(o => o.hp > 0);
  if (!standing.length) return { id: "wait" };

  const threatNow = standing.some(o => aimed(o, nextStart, from, board));
  const threatNext = standing.some(o => aimed(o, nextStart + 1, from, board));
  // Prevent a visibly telegraphed hit, but never evade attacks not yet reserved.
  // Sometimes trade a quick blow rather than endlessly turtling against repeated jabs.
  if (threatNow && turn % 3 !== 0 && canChoose("quick") &&
      standing.some(o => adjacent8(from, o.at)))
    return { id: "quick", target: standing.find(o => adjacent8(from, o.at)).id };
  if (threatNow && canChoose("guard")) return { id: "guard" };
  if (threatNext && canChoose("dodge")) return { id: "dodge" };

  const scored = [...standing].sort((a, b) => {
    const score = o => {
      const gap = distance(from, o.at);
      const state = pending(o, nextStart + 1);
      const vulnerable = state && ["heavy", "fire", "jump", "jumpSlash", "wait"].includes(state.commandId);
      return (100 - o.hp) * .65 - gap * 5.5 + (adjacent8(from, o.at) ? 8 : 0)
        + (o.landingAvailable && gap > 1 ? 5 : 0)
        + (vulnerable ? 16 : 0);
    };
    return score(b) - score(a) || a.id.localeCompare(b.id);
  });
  const target = (previous === "jump" && standing.find(o => o.id === lockedTarget))
    || scored[0];
  const gap = distance(from, target.at);
  if (previous === "jump" && canChoose("jumpSlash"))
    return { id: "jumpSlash", target: target.id };

  const inFire = standing.filter(o => fireReaches(from, o.at, board));
  if (inFire.length >= 2 && canChoose("fire")) {
    return { id: "fire", target: inFire.sort((a,b)=>a.hp-b.hp)[0].id };
  }
  if (adjacent8(from, target.at)) {
    // Strike a player committed to a slow action before their impact comes out.
    // A moving target can slip beyond melee, but is often still inside the fire zone.
    if (target.actions?.some(a => a.status === "pending" && a.commandId === "move"
        && a.impact >= nextStart && a.impact <= nextStart + 2)
        && fireReaches(from, target.at, board) && canChoose("fire"))
      return { id: "fire", target: target.id };
    const windup = pending(target, nextStart);
    if (windup?.commandId === "jump" && canChoose("quick"))
      return { id: "quick", target: target.id };
    if (windup?.commandId === "heavy" && canChoose("quick"))
      return { id: "quick", target: target.id };
    if (windup?.commandId === "fire" && canChoose("heavy"))
      return { id: "heavy", target: target.id };
    if (turn % 4 !== 3 && canChoose("heavy")) return { id: "heavy", target: target.id };
    if (canChoose("quick")) return { id: "quick", target: target.id };
  }

  // Close in aggressively. Jump-slash is worth the setup only if the leap looks safe.
  if (gap >= 2 && gap <= 4 && target.landingAvailable
      && !standing.some(o => aimed(o, nextStart + 1, from, board))
      && stamina >= 4 && canChoose("jump")) return { id: "jump", target: target.id };

  if (inFire.length && (gap > 1 || hp < 40) && canChoose("fire"))
    return { id: "fire", target: inFire[0].id };

  // Route around occupied spaces; choose a reachable cell with the greatest distance reduction.
  const move = rangeStep(from, target.at, -1, cell => canChoose("move", cell), board);
  if (move) return { id: "move", destination: move, target: target.id };
  // Try any legal cardinal step if the closest route is blocked by a fighter.
  const offsets = [[1,0],[-1,0],[0,1],[0,-1]];
  const alternatives = offsets.map(([dx,dy])=>({x:from.x+dx,y:from.y+dy}))
    .filter(cell=>canChoose("move",cell))
    .sort((a,b)=>distance(a,target.at)-distance(b,target.at));
  if (alternatives.length && gap > 1) return { id:"move",destination:alternatives[0],target:target.id };
  if (canChoose("quick") && adjacent8(from, target.at)) return { id:"quick",target:target.id };
  if (canChoose("guard") && threatNext) return { id:"guard" };
  return { id:"wait", target:target.id };
}
