import {
  GRID_COLUMNS, GRID_ROWS, MOVE, cellName, enemyThreats, plannedPosition,
  gridSides, teamOf, jumpLandingCandidates, jumpLanding, targetFor
} from "./grid-rules.js?v=7";
import { COMMANDS, canReserve, isManual, editableAttack } from "./rules.js?v=13";
import { bindGridMotion } from "./grid-motion.js?v=9";
import { terrainAt } from "./grid-terrain.js?v=2";

const shortNames = {
  player: "MAGE", ally: "味方", ally2: "味方2", ally3: "味方3",
  enemy: "敵1", enemy2: "敵2", enemy3: "敵3", enemy4: "敵4"
};

export function bindBattleGrid({ onMove, onTarget, onSelect, onLanding }) {
  const board = document.getElementById("grid-board");
  const cue = document.getElementById("grid-threat");
  const plan = document.getElementById("grid-plan");
  const result = document.getElementById("grid-result");
  const renderMotion = bindGridMotion(document.getElementById("grid-units"));
  const terrainPicker = document.getElementById("grid-terrain");
  const playfield = document.getElementById("grid-playfield");
  const viewport = document.getElementById("grid-viewport");
  const cells = [];
  let currentColumns = 0;
  let currentRows = 0;

  function buildCells(columns, rows) {
    cells.length = 0;
    board.replaceChildren();
    playfield.style.setProperty("--grid-columns", columns);
    playfield.style.setProperty("--grid-rows", rows);
    playfield.style.setProperty("--grid-min-width", `${columns * 46 + (columns - 1) * 4}px`);
    viewport.style.setProperty("--grid-target-width", `${columns * 56 + (columns - 1) * 4}px`);
    playfield.dataset.expanded = String(columns > GRID_COLUMNS || rows > GRID_ROWS);
    board.setAttribute("aria-label", `戦場 ${columns}列 ${rows}行`);
    for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const button = document.createElement("button");
      const label = cellName({ x, y });
      const coord = document.createElement("span");
      coord.className = "grid-cell-coord";
      coord.textContent = label;
      coord.setAttribute("aria-hidden", "true");
      const content = document.createElement("span");
      content.className = "grid-cell-main";
      content.setAttribute("aria-hidden", "true");
      const cell = { button, position: { x, y }, label, content, target: null, crew: null };
      button.type = "button";
      button.style.setProperty("--tile-x", `${-((x * 9 + y * 5) % 4) * 6}px`);
      button.style.setProperty("--tile-y", `${-((x * 3 + y * 11) % 4) * 6}px`);
      button.replaceChildren(coord, content);
      button.addEventListener("click", () => {
        if (cell.crew) onSelect(cell.crew);
        else if (cell.target) onTarget(cell.target);
        else if (cell.landing) onLanding(cell.landing);
        else onMove(cell.position);
      });
      cells.push(cell);
      board.append(button);
    }
    }
    currentColumns = columns;
    currentRows = rows;
  }

  return (battle, processed, controlled, selected) => {
    const columns = battle.grid.columns ?? GRID_COLUMNS;
    const rows = battle.grid.rows ?? GRID_ROWS;
    if (columns !== currentColumns || rows !== currentRows) buildCells(columns, rows);
    const scene = terrainPicker?.value ?? "mixed";
    board.dataset.terrain = scene;
    const threats = enemyThreats(battle);
    const danger = new Set(threats.flatMap(threat => threat.cells.map(cellName)));
    const occupants = new Map(gridSides(battle).filter(id => battle[id].hp > 0).map(id => [cellName(battle.grid[id]), id]));
    const playerCell = cellName(battle.grid[controlled]);
    const plannedCell = cellName(plannedPosition(battle, controlled));
    const manual = isManual(battle, controlled) && battle.phase !== "finished";
    const editing = editableAttack(battle, controlled);
    const previewTarget = targetFor(battle, controlled, editing?.targetSide || selected);
    const previewing = !!editing;
    const imminent = previewing && battle.phase === "running" && editing.impact === battle.tick + 1;
    const landingOptions = editing?.commandId === "jumpSlash" && previewTarget
      ? jumpLandingCandidates(battle, controlled, previewTarget) : [];
    const landingKey = cellName(jumpLanding(battle, controlled, previewTarget,
      battle.grid[controlled], editing?.landing, editing?.manualLanding) ?? { x: -10, y: -10 });
    const candidateKeys = new Set(landingOptions.map(cellName));
    for (const cell of cells) {
      const { button, position, label } = cell;
      const id = occupants.get(label);
      const occupant = id === "enemy" && !battle.enemy2
        ? (battle.grid.enemyName || "見張り") : shortNames[id];
      const hazardous = danger.has(label);
      const booked = label !== playerCell && label === plannedCell;
      const targetable = manual && battle.enemy2 && id && teamOf(id) === "enemy";
      const selectable = battle.ally && id && teamOf(id) === "player" && battle.phase !== "finished";
      const landingOption = manual && editing?.commandId === "jumpSlash" && candidateKeys.has(label);
      const currentLanding = landingOption && label === landingKey;
      const luminousTarget = previewing && previewTarget === id;
      cell.target = targetable ? id : null;
      cell.crew = selectable ? id : null;
      cell.landing = landingOption ? position : null;
      button.className = `grid-cell terrain-${terrainAt(position.x, position.y, scene)}`;
      if (occupant) button.className += teamOf(id) === "player" ? " grid-player" : " grid-enemy";
      if (hazardous) button.className += " grid-danger";
      if (booked) button.className += " grid-booked";
      if (targetable) button.className += " grid-targetable";
      if (targetable && (previewTarget ?? selected) === id) button.className += " grid-aimed";
      if (luminousTarget && imminent) button.className += " grid-impact-target";
      if (landingOption) button.className += " grid-landing-option";
      if (currentLanding) button.className += " grid-landing-selected";
      if (id && controlled === id) button.className += " grid-controlled";
      button.disabled = !selectable && !targetable && !landingOption
        && !(manual && canReserve(battle, controlled, "move", position));
      cell.content.textContent = occupant || (currentLanding ? "着地" : landingOption ? "候補" :
        booked ? "移動先" : hazardous ? "！" : "");
      const details = [label, occupant, booked ? "移動予定" : "", hazardous ? "攻撃範囲" : "",
        targetable ? previewTarget === id ? "選択中の攻撃対象" : "攻撃対象に選ぶ" : "",
        imminent && luminousTarget ? "次の枠に攻撃発動" : "",
        landingOption ? currentLanding ? "ジャンプ斬りの着地点" : "着地点に変更" : "",
        selectable ? controlled === id ? "選択中の味方" : "操作キャラに選ぶ" : ""].filter(Boolean);
      button.setAttribute("aria-label", details.join("、"));
    }

    cue.textContent = threats.map(({ side, action }) => {
      const who = battle.enemy2 ? shortNames[side] + " " : "";
      return `${who}${action.impact}枠目★ ${COMMANDS[action.commandId].name}`;
    }).join(" ／ ") || (battle.phase === "finished" ? "戦闘終了" : "いま構えている攻撃はありません。");
    const location = plannedCell === playerCell ? playerCell : `${playerCell} → ${plannedCell}`;
    const name = shortNames[controlled];
    const aiming = previewTarget && manual ? ` · 狙い ${shortNames[previewTarget]}` : "";
    const jumpSpot = editing?.commandId === "jumpSlash" && landingOptions.length
      ? ` · 着地 ${landingKey}${editing.manualLanding ? "（指定）" : "（自動）"}` : "";
    const notice = imminent ? " · 次の★！対象と着地点をタップで変更可"
      : previewing && battle.phase === "planning" ? " · ★予約を編集可" : "";
    plan.textContent = battle[controlled].hp
      ? `${name} ${location}${aiming}${jumpSpot}${notice}${battle[controlled].automatic ? " · AUTO" : ` · 移動 SC${MOVE.sc}`}`
      : `${name}は戦闘不能。`;
    result.textContent = battle.grid.notice;
    renderMotion(battle, processed);
  };
}
