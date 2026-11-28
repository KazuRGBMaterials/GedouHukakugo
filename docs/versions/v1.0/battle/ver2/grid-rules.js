export const GRID_COLUMNS = 5;
export const GRID_ROWS = 5;
export const MOVE = { name: "移動", tc: 1, impact: 1, sc: 0.5, level: 0 };
const cardinal = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const fireOffsets = [
  ...cardinal, ...cardinal.map(([x, y]) => [2 * x, 2 * y]),
  [-1, -1], [1, -1], [-1, 1], [1, 1]
];

export const cellName = ({ x, y }) => `${"ABCDE"[x]}${y + 1}`;
const sameCell = (a, b) => a.x === b.x && a.y === b.y;
export const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const inside = ({ x, y }) => Number.isInteger(x) && Number.isInteger(y)
  && x >= 0 && x < GRID_COLUMNS && y >= 0 && y < GRID_ROWS;
const cellsAround = ({ x, y }, offsets) => offsets.map(([dx, dy]) => ({ x: x + dx, y: y + dy })).filter(inside);

export const teamOf = side => side === "player" || side === "ally" ? "player" : "enemy";
export const gridSides = battle => ["player", ...(battle.ally ? ["ally"] : []), "enemy", ...(battle.enemy2 ? ["enemy2"] : [])];
export const opposingSides = (battle, side) => gridSides(battle).filter(id => teamOf(id) !== teamOf(side) && battle[id].hp > 0);

export function createGrid(players, enemies) {
  return {
    player: { x: 1, y: 2 }, enemy: { x: 2, y: 2 },
    ...(players === 2 && { ally: { x: 1, y: 3 } }),
    ...(enemies === 2 && { enemy2: { x: 2, y: 3 } }),
    notice: "", roundHits: []
  };
}

export function targetFor(battle, side, requested, from = battle.grid[side]) {
  const available = opposingSides(battle, side);
  if (available.includes(requested)) return requested;
  return available.reduce((closest, id) =>
    !closest || distance(battle.grid[id], from) < distance(battle.grid[closest], from) ? id : closest, null);
}

function clearCell(battle, side, to) {
  return !gridSides(battle).some(id => id !== side && battle[id].hp > 0 && sameCell(battle.grid[id], to));
}

export function canStep(battle, side, from, to) {
  return to && inside(to) && distance(from, to) === 1 && clearCell(battle, side, to);
}

export function rangeStep(from, target, sign, legal) {
  const gap = distance(from, target);
  return cellsAround(from, cardinal).find(cell => distance(cell, target) === gap + sign && legal(cell));
}

export function jumpLanding(battle, side, target, from = battle.grid[side]) {
  const to = battle.grid[target];
  const gap = distance(from, to);
  if (gap < 2 || gap > 3 || (from.x !== to.x && from.y !== to.y)) return null;
  const landing = { x: to.x - Math.sign(to.x - from.x), y: to.y - Math.sign(to.y - from.y) };
  return clearCell(battle, side, landing) ? landing : null;
}

export function plannedPosition(battle, side = "player") {
  let position = battle.grid[side];
  for (const action of battle[side].actions) {
    if (action.status !== "pending" || action.impact <= battle.tick) continue;
    if (action.commandId === "move") position = action.destination;
    if (action.commandId === "jumpSlash") {
      const target = targetFor(battle, side, action.targetSide, position);
      if (target) position = jumpLanding(battle, side, target, position) ?? position;
    }
  }
  return position;
}

export function fireCells(from) {
  return cellsAround(from, fireOffsets);
}

export function fireReaches(from, to) {
  return fireCells(from).some(cell => sameCell(cell, to));
}

export function attackTargets(battle, side, action) {
  const from = battle.grid[side];
  if (action.commandId === "fire") {
    return opposingSides(battle, side).filter(id => fireReaches(from, battle.grid[id]));
  }
  const target = targetFor(battle, side, action.targetSide);
  if (!target) return [];
  if (distance(from, battle.grid[target]) === 1) return [target];
  return action.commandId === "jumpSlash" && jumpLanding(battle, side, target) ? [target] : [];
}

export function resolveMovement(battle, actions, landings, report) {
  const { grid, tick } = battle;
  const desired = new Map();
  for (const id of gridSides(battle)) {
    const action = actions[id];
    if (!battle[id].hp || action?.impact !== tick) continue;
    if (landings.has(id)) desired.set(id, landings.get(id));
    if (action.commandId !== "move") continue;
    const to = action.destination;
    if (canStep(battle, id, grid[id], to)) desired.set(id, to);
    else report(`${cellName(to)}へ移動できなかった。`);
  }

  const claims = [...desired.values()].map(cellName);
  const shared = new Set(claims.filter((label, index) => claims.indexOf(label) !== index));
  for (const label of shared) report(`${label}で移動先が重なり、その場に残った。`);
  for (const [id, cell] of desired) {
    if (!shared.has(cellName(cell))) grid[id] = cell;
  }
}

export function enemyThreats(battle) {
  if (battle.phase === "finished") return [];
  const { grid, tick } = battle;
  return opposingSides(battle, "player").flatMap(side => {
    const action = battle[side].actions.find(item => item.status === "pending" && item.start <= tick + 1 && item.impact > tick);
    if (action?.commandId === "fire") return [{ side, action, cells: fireCells(grid[side]) }];
    if (action?.commandId === "heavy" || action?.commandId === "quick") {
      return [{ side, action, cells: cellsAround(grid[side], cardinal) }];
    }
    return [];
  });
}
