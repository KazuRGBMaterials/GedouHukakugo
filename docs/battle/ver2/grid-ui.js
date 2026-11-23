import { GRID_COLUMNS, GRID_ROWS, MOVE, cellName, enemyThreats, plannedPosition, gridSides, teamOf } from "./grid-rules.js?v=4";
import { COMMANDS, canReserve, isManual } from "./rules.js?v=7";
import { bindGridMotion } from "./grid-motion.js?v=4";

const shortNames = { player: "MAGE", ally: "味方", enemy: "敵1", enemy2: "敵2" };

export function bindBattleGrid({ onMove, onTarget, onSelect }) {
  const board = document.getElementById("grid-board");
  const cue = document.getElementById("grid-threat");
  const plan = document.getElementById("grid-plan");
  const result = document.getElementById("grid-result");
  const renderMotion = bindGridMotion(document.getElementById("grid-units"));
  const cells = [];

  for (let y = 0; y < GRID_ROWS; y++) {
    for (let x = 0; x < GRID_COLUMNS; x++) {
      const button = document.createElement("button");
      const cell = { button, position: { x, y }, label: cellName({ x, y }), target: null, crew: null };
      button.type = "button";
      button.addEventListener("click", () => {
        if (cell.crew) onSelect(cell.crew);
        else if (cell.target) onTarget(cell.target);
        else onMove(cell.position);
      });
      cells.push(cell);
      board.append(button);
    }
  }

  return (battle, processed, controlled, selected) => {
    const threats = enemyThreats(battle);
    const danger = new Set(threats.flatMap(threat => threat.cells.map(cellName)));
    const occupants = new Map(gridSides(battle).filter(id => battle[id].hp > 0).map(id => [cellName(battle.grid[id]), id]));
    const playerCell = cellName(battle.grid[controlled]);
    const plannedCell = cellName(plannedPosition(battle, controlled));
    const manual = isManual(battle, controlled) && battle.phase !== "finished";
    for (const cell of cells) {
      const { button, position, label } = cell;
      const id = occupants.get(label);
      const occupant = id === "enemy" && !battle.enemy2 ? "見張り" : shortNames[id];
      const hazardous = danger.has(label);
      const booked = label !== playerCell && label === plannedCell;
      const targetable = manual && battle.enemy2 && id && teamOf(id) === "enemy";
      const selectable = battle.ally && id && teamOf(id) === "player" && battle.phase !== "finished";
      cell.target = targetable ? id : null;
      cell.crew = selectable ? id : null;
      button.className = "grid-cell";
      if (occupant) button.className += teamOf(id) === "player" ? " grid-player" : " grid-enemy";
      if (hazardous) button.className += " grid-danger";
      if (booked) button.className += " grid-booked";
      if (targetable) button.className += " grid-targetable";
      if (targetable && selected === id) button.className += " grid-aimed";
      if (id && controlled === id) button.className += " grid-controlled";
      button.disabled = !selectable && !targetable && !(manual && canReserve(battle, controlled, "move", position));
      button.textContent = occupant || (booked ? "移動先" : hazardous ? "！" : label);
      const details = [label, occupant, booked ? "移動予定" : "", hazardous ? "攻撃範囲" : "",
        targetable ? selected === id ? "選択中の攻撃対象" : "攻撃対象に選ぶ" : "",
        selectable ? controlled === id ? "選択中の味方" : "操作キャラに選ぶ" : ""].filter(Boolean);
      button.setAttribute("aria-label", details.join("、"));
    }

    cue.textContent = threats.map(({ side, action }) => {
      const who = battle.enemy2 ? shortNames[side] + " " : "";
      return `${who}${action.impact}枠目★ ${COMMANDS[action.commandId].name}`;
    }).join(" ／ ") || (battle.phase === "finished" ? "戦闘終了" : "いま構えている攻撃はありません。");
    const location = plannedCell === playerCell ? playerCell : `${playerCell} → ${plannedCell}`;
    const name = shortNames[controlled];
    const aiming = battle.enemy2 && selected && manual ? ` · 狙い ${shortNames[selected]}` : "";
    plan.textContent = battle[controlled].hp
      ? `${name} ${location}${aiming}${battle[controlled].automatic ? " · AUTO" : ` · 移動 SC${MOVE.sc}`}`
      : `${name}は戦闘不能。`;
    result.textContent = battle.grid.notice;
    renderMotion(battle, processed);
  };
}
