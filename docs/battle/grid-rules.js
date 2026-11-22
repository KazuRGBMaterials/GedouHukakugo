export const GRID_COLUMNS = 5;
export const GRID_ROWS = 3;
export const MOVE = { name: "移動", tc: 1, impact: 1, sc: 0, level: 0 };
const FIRE_RANGE = 3;
const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export const cellName = ({ x, y }) => `${"ABCDE"[x]}${y + 1}`;
const sameCell = (a, b) => a.x === b.x && a.y === b.y;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const inside = ({ x, y }) => Number.isInteger(x) && Number.isInteger(y)
  && x >= 0 && x < GRID_COLUMNS && y >= 0 && y < GRID_ROWS;
const neighbors = ({ x, y }) => directions.map(([dx, dy]) => ({ x: x + dx, y: y + dy })).filter(inside);
const otherSide = side => side === "player" ? "enemy" : "player";

export function createGrid() {
  return { player: { x: 1, y: 1 }, enemy: { x: 2, y: 1 }, notice: "" };
}

function jumpLanding(from, target) {
  const gap = distance(from, target);
  if (gap < 2 || gap > 3 || (from.x !== target.x && from.y !== target.y)) return null;
  return { x: target.x - Math.sign(target.x - from.x), y: target.y - Math.sign(target.y - from.y) };
}

export function plannedPosition(battle) {
  let position = battle.grid.player;
  for (const action of battle.player.actions) {
    if (action.status !== "pending" || action.impact <= battle.tick) continue;
    if (action.commandId === "move") position = action.destination;
    if (action.commandId === "jumpSlash") position = jumpLanding(position, battle.grid.enemy) ?? position;
  }
  return position;
}

export function canStep(from, to, occupied) {
  return to && inside(to) && !sameCell(to, occupied) && distance(from, to) === 1;
}

export function prepareFire(grid, side, action) {
  if (action?.commandId === "fire" && action.status === "pending" && !action.targetCell) {
    // Positions are replaced on movement, so the cell stays locked through impact and shifts.
    action.targetCell = grid[otherSide(side)];
  }
}

export function attackReaches(grid, side, action) {
  const from = grid[side];
  const target = grid[otherSide(side)];
  if (action.commandId === "fire") {
    return sameCell(action.targetCell, target) && distance(from, action.targetCell) <= FIRE_RANGE;
  }
  if (action.commandId === "jumpSlash" && jumpLanding(from, target)) return true;
  return distance(from, target) === 1;
}

function pursue(from, target) {
  const gap = distance(from, target);
  return neighbors(from).sort((a, b) => distance(a, target) - distance(b, target))
    .find(candidate => distance(candidate, target) > 0 && distance(candidate, target) < gap);
}

export function resolveMovement(battle, playerAction, enemyAction, jumpHit, report) {
  const { grid, tick } = battle;
  let playerTo;
  let enemyTo;
  if (battle.player.hp && playerAction?.impact === tick) {
    if (playerAction.commandId === "move") {
      if (canStep(grid.player, playerAction.destination, grid.enemy)) playerTo = playerAction.destination;
      else report(`MAGEは${cellName(playerAction.destination)}に移動できなかった。`);
    }
    if (playerAction.commandId === "jumpSlash" && jumpHit) playerTo = jumpLanding(grid.player, grid.enemy);
  }
  if (battle.enemy.hp && enemyAction?.commandId === "move" && enemyAction.impact === tick) {
    enemyTo = pursue(grid.enemy, grid.player);
  }
  if (playerTo && enemyTo && sameCell(playerTo, enemyTo)) {
    report(`${cellName(playerTo)}で移動先が重なったため、双方ともその場に残った。`);
    return;
  }
  if (playerTo) grid.player = playerTo;
  if (enemyTo) grid.enemy = enemyTo;
}

export function enemyThreat(battle) {
  if (battle.phase === "finished") return null;
  const { grid, tick } = battle;
  const action = battle.enemy.actions.find(item => item.status === "pending" && item.start <= tick + 1 && item.impact > tick);
  if (!action) return null;
  if (action.commandId === "fire") {
    const target = action.targetCell ?? grid.player;
    return { action, cells: distance(grid.enemy, target) <= FIRE_RANGE ? [target] : [] };
  }
  if (action.commandId === "heavy" || action.commandId === "quick") {
    return { action, cells: neighbors(grid.enemy) };
  }
  return null;
}
