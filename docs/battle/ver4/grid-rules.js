export const GRID_COLUMNS = 5;
export const GRID_ROWS = 5;
export const GRID_MIN = 5;
export const GRID_MAX = 15;
export function normalizeGridSize(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(GRID_MIN, Math.min(GRID_MAX, Math.trunc(number))) : GRID_COLUMNS;
}
export const PARTY_SIDES = ["player", "ally", "ally2", "ally3"];
export const FOE_SIDES = ["enemy", "enemy2", "enemy3", "enemy4"];
export const MOVE = { name: "移動", tc: 1, impact: 1, sc: 0.5, level: 0 };
const cardinal = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const diagonal = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const nearOffsets = [...cardinal, ...diagonal];
const fireOffsets = [
  ...cardinal, ...cardinal.map(([x, y]) => [2 * x, 2 * y]),
  ...diagonal
];

export const cellName = ({ x, y }) => `${String.fromCharCode(65 + x)}${y + 1}`;
const sameCell = (a, b) => a.x === b.x && a.y === b.y;
export const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const adjacent8 = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) === 1;
const inside = ({ x, y }, grid) => Number.isInteger(x) && Number.isInteger(y)
  && x >= 0 && x < (grid?.columns ?? GRID_COLUMNS)
  && y >= 0 && y < (grid?.rows ?? GRID_ROWS);
const cellsAround = ({ x, y }, offsets, grid) =>
  offsets.map(([dx, dy]) => ({ x: x + dx, y: y + dy })).filter(cell => inside(cell, grid));

export const teamOf = side => PARTY_SIDES.includes(side) ? "player" : "enemy";
export const gridSides = battle => [...PARTY_SIDES, ...FOE_SIDES].filter(side => Boolean(battle[side]));
export const opposingSides = (battle, side) => gridSides(battle).filter(id => teamOf(id) !== teamOf(side) && battle[id].hp > 0);

export function createGrid(players, enemies, columns = GRID_COLUMNS, rows = GRID_ROWS) {
  const width = normalizeGridSize(columns);
  const height = normalizeGridSize(rows);
  const grid = { columns: width, rows: height, notice: "", roundHits: [] };
  if (width === GRID_COLUMNS && height === GRID_ROWS && players <= 2 && enemies <= 2) {
    // Preserve VER2's original 5x5 deployment exactly.
    grid.player = { x: 1, y: 2 };
    grid.enemy = { x: 2, y: 2 };
    if (players === 2) grid.ally = { x: 1, y: 3 };
    if (enemies === 2) grid.enemy2 = { x: 2, y: 3 };
    return grid;
  }
  // Other layouts start in separate columns, spaced appropriately for the field width.
  for (const [sides, count, x] of [[PARTY_SIDES, players, 1], [FOE_SIDES, enemies, width - 2]]) {
    const firstRow = Math.floor((height - count) / 2);
    for (let index = 0; index < count; index++) {
      grid[sides[index]] = { x, y: firstRow + index };
    }
  }
  return grid;
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
  return to && inside(to, battle.grid) && distance(from, to) === 1 && clearCell(battle, side, to);
}

export function rangeStep(from, target, sign, legal, grid) {
  const gap = distance(from, target);
  return cellsAround(from, cardinal, grid).find(cell => distance(cell, target) === gap + sign && legal(cell));
}

// A plunge can strike a target up to four orthogonal steps away, including diagonals.
export function jumpLandingCandidates(battle, side, target, from = battle.grid[side]) {
  const to = battle.grid[target];
  if (!from || !to || !battle[target]?.hp) return [];
  const gap = distance(from, to);
  if (gap < 1 || gap > 4) return [];
  return cellsAround(to, nearOffsets, battle.grid)
    .filter(cell => !sameCell(cell, from)
      && Math.max(Math.abs(cell.x - from.x), Math.abs(cell.y - from.y)) <= 3
      && clearCell(battle, side, cell))
    .sort((a, b) => distance(a, from) - distance(b, from)
      || a.y - b.y || a.x - b.x);
}

export function jumpLanding(battle, side, target, from = battle.grid[side], preferred = null, manual = false) {
  const candidates = jumpLandingCandidates(battle, side, target, from);
  const requested = preferred && candidates.find(cell => sameCell(cell, preferred));
  return manual ? (requested ?? null) : (requested ?? candidates[0] ?? null);
}

export function plannedPosition(battle, side = "player") {
  let position = battle.grid[side];
  for (const action of battle[side].actions) {
    if (action.status !== "pending" || action.impact <= battle.tick) continue;
    if (action.commandId === "move") position = action.destination;
    if (action.commandId === "jumpSlash") {
      const target = targetFor(battle, side, action.targetSide, position);
      if (target) position = jumpLanding(battle, side, target, position, action.landing, action.manualLanding) ?? position;
    }
  }
  return position;
}

export function fireCells(from, grid) {
  return cellsAround(from, fireOffsets, grid);
}

export function fireReaches(from, to, grid) {
  return fireCells(from, grid).some(cell => sameCell(cell, to));
}

export function attackTargets(battle, side, action) {
  const from = battle.grid[side];
  if (action.commandId === "fire") {
    return opposingSides(battle, side).filter(id => fireReaches(from, battle.grid[id], battle.grid));
  }
  const target = targetFor(battle, side, action.targetSide);
  if (!target) return [];
  if (action.commandId === "jumpSlash") {
    return jumpLanding(battle, side, target, from, action.landing, action.manualLanding) ? [target] : [];
  }
  return adjacent8(from, battle.grid[target]) ? [target] : [];
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
    if (action?.commandId === "fire") return [{ side, action, cells: fireCells(grid[side], grid) }];
    if (action?.commandId === "heavy" || action?.commandId === "quick") {
      return [{ side, action, cells: cellsAround(grid[side], nearOffsets, grid) }];
    }
    return [];
  });
}
