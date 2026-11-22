import { GRID_COLUMNS, GRID_ROWS, MOVE, cellName, enemyThreats, plannedPosition, gridSides, teamOf } from "./grid-rules.js?v=3";
import { COMMANDS, canReserve } from "./rules.js?v=6";
import { bindGridMotion } from "./grid-motion.js?v=3";

const shortNames = { player: "MAGE", ally: "味方", enemy: "敵1", enemy2: "敵2" };

export function bindBattleGrid(onMove, onTarget) {
  const board = document.getElementById("grid-board");
  const cue = document.getElementById("grid-threat");
  const plan = document.getElementById("grid-plan");
  const result = document.getElementById("grid-result");
  const renderMotion = bindGridMotion(document.getElementById("grid-units"));
  const cells = [];

  for (let y = 0; y < GRID_ROWS; y++) {
    for (let x = 0; x < GRID_COLUMNS; x++) {
      const button = document.createElement("button");
      const cell = { button, position: { x, y }, label: cellName({ x, y }), target: null };
      button.type = "button";
      button.addEventListener("click", () => {
        if (cell.target) onTarget(cell.target);
        else onMove(cell.position);
      });
      cells.push(cell);
      board.append(button);
    }
  }

  return (battle, processed, selected) => {
    const threats = enemyThreats(battle);
    const danger = new Set(threats.flatMap(threat => threat.cells.map(cellName)));
    const occupants = new Map(gridSides(battle).filter(id => battle[id].hp > 0).map(id => [cellName(battle.grid[id]), id]));
    const playerCell = cellName(battle.grid.player);
    const plannedCell = cellName(plannedPosition(battle));
    for (const cell of cells) {
      const { button, position, label } = cell;
      const id = occupants.get(label);
      const occupant = id === "enemy" && !battle.enemy2 ? "見張り" : shortNames[id];
      const hazardous = danger.has(label);
      const booked = label !== playerCell && label === plannedCell;
      const targetable = battle.enemy2 && battle.player.hp && id && teamOf(id) === "enemy" && battle.phase !== "finished";
      cell.target = targetable ? id : null;
      button.className = "grid-cell";
      if (occupant) button.className += teamOf(id) === "player" ? " grid-player" : " grid-enemy";
      if (hazardous) button.className += " grid-danger";
      if (booked) button.className += " grid-booked";
      if (targetable) button.className += " grid-targetable";
      if (targetable && selected === id) button.className += " grid-aimed";
      button.disabled = !targetable && !canReserve(battle, "player", "move", position);
      button.textContent = occupant || (booked ? "移動先" : hazardous ? "！" : label);
      const details = [label, occupant, booked ? "移動予定" : "", hazardous ? "攻撃範囲" : "",
        targetable ? selected === id ? "選択中の攻撃対象" : "攻撃対象に選ぶ" : ""].filter(Boolean);
      button.setAttribute("aria-label", details.join("、"));
    }

    cue.textContent = threats.map(({ side, action }) => {
      const who = battle.enemy2 ? shortNames[side] + " " : "";
      return `${who}${action.impact}枠目★ ${COMMANDS[action.commandId].name}`;
    }).join(" ／ ") || (battle.phase === "finished" ? "戦闘終了" : "いま構えている攻撃はありません。");
    const location = plannedCell === playerCell ? playerCell : `${playerCell} → ${plannedCell}`;
    plan.textContent = battle.player.hp ? `MAGE ${location}${battle.enemy2 && selected ? ` · 狙い ${shortNames[selected]}` : ""} · 移動 SC${MOVE.sc}`
      : battle.phase === "finished" ? "MAGEは戦闘不能。" : "MAGEは戦闘不能。味方が戦闘を続けます。";
    result.textContent = battle.grid.notice;
    renderMotion(battle, processed);
  };
}
