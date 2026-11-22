import { GRID_COLUMNS, GRID_ROWS, cellName, enemyThreat, plannedPosition } from "./grid-rules.js?v=2";
import { COMMANDS, canReserve } from "./rules.js?v=5";
import { bindGridMotion } from "./grid-motion.js?v=2";

export function bindBattleGrid(onMove) {
  const board = document.getElementById("grid-board");
  const cue = document.getElementById("grid-threat");
  const plan = document.getElementById("grid-plan");
  const result = document.getElementById("grid-result");
  const renderMotion = bindGridMotion(document.getElementById("grid-units"));
  const cells = [];

  for (let y = 0; y < GRID_ROWS; y++) {
    for (let x = 0; x < GRID_COLUMNS; x++) {
      const button = document.createElement("button");
      const position = { x, y };
      const label = cellName(position);
      button.type = "button";
      button.addEventListener("click", () => onMove(position));
      cells.push({ button, position, label });
      board.append(button);
    }
  }

  return (battle, processed) => {
    const threat = enemyThreat(battle);
    const danger = new Set(threat?.cells.map(cellName));
    const playerCell = cellName(battle.grid.player);
    const enemyCell = cellName(battle.grid.enemy);
    const plannedCell = cellName(plannedPosition(battle));
    for (const { button, position, label } of cells) {
      const occupant = label === playerCell ? "MAGE" : label === enemyCell ? "見張り" : "";
      const hazardous = danger.has(label);
      const booked = label !== playerCell && label === plannedCell;
      button.className = "grid-cell";
      if (occupant) button.className += label === playerCell ? " grid-player" : " grid-enemy";
      if (hazardous) button.className += " grid-danger";
      if (booked) button.className += " grid-booked";
      button.disabled = !canReserve(battle, "player", "move", position);
      button.textContent = occupant || (booked ? "移動先" : hazardous ? "！" : label);
      const details = [label, occupant, booked ? "移動予定" : "", hazardous ? "攻撃範囲" : ""].filter(Boolean);
      button.setAttribute("aria-label", details.join("、"));
    }

    if (threat) {
      const { action } = threat;
      const namedCells = threat.cells.map(cellName).join("・");
      cue.textContent = `${action.impact}枠目 ★ ${COMMANDS[action.commandId].name} · ${namedCells || "射程外"}`;
    } else {
      cue.textContent = battle.phase === "finished" ? "戦闘終了" : "現在、構えている攻撃はありません。";
    }
    plan.textContent = plannedCell === playerCell ? `現在地 ${playerCell}` : `現在地 ${playerCell} → 行動後の予定 ${plannedCell}`;
    result.textContent = battle.grid.notice;
    renderMotion(battle, processed);
  };
}
