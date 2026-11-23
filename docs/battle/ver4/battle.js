import {
  COMMANDS, TIMELINE_SIZE, SHIFT_STAMINA, createBattle, canReserve, reserve,
  canShiftImpact, shiftImpact, startBattle, nextAction, nextRecovery, advanceBattle, fighterName,
  isManual, setAutomatic, setQueuedTarget, setQueuedLanding
} from "./rules.js?v=12";
import { createBattleAudio } from "./audio.js?v=1";
import { MOVE, cellName, gridSides, targetFor, teamOf, PARTY_SIDES, FOE_SIDES, normalizeGridSize } from "./grid-rules.js?v=7";
import { bindBattleGrid } from "./grid-ui.js?v=12";
import { bindBattleFullscreen } from "./fullscreen.js?v=1";
import { bindGameTaps } from "./assets/game-taps.js?v=1";

const el = id => document.getElementById(id);
const labels = { quick: "通常", heavy: "強打", fire: "火炎", guard: "防御", dodge: "回避", jump: "ジャンプ", jumpSlash: "空中斬り" };
const colorNames = { yellow: "黄", blue: "青", red: "赤" };
const windups = { quick: "踏み込み", heavy: "振りかぶり", fire: "詠唱中", jumpSlash: "空中で構え" };
const names = { player: "MAGE", enemy: "見張り" };
const warnings = { heavy: "heavyWarning", fire: "fireWarning" };
const outcomeSounds = { 勝利: "victory", 敗北: "defeat", 相打ち: "draw" };
const planningSeconds = 8;
const urlParams = new URLSearchParams(window.location.search);
const gridMode = true; // VER4 always launches the grid battle.
const enemyName = urlParams.get("encounter")?.trim().slice(0, 40);
const enemyChoiceField = gridMode ? el("grid-enemy") : null;
if (enemyChoiceField && enemyName) {
  if (enemyName === "ヘルオル") {
    enemyChoiceField.value = "hellor";
  } else {
    const option = document.createElement("option");
    option.value = "encounter";
    option.textContent = enemyName;
    enemyChoiceField.append(option);
    enemyChoiceField.value = "encounter";
  }
}
const sizeField = gridMode ? el("grid-size") : null;
const columnsField = gridMode ? el("grid-columns") : null;
const rowsField = gridMode ? el("grid-rows") : null;
const profileFields = gridMode ? {
  risk: el("grid-risk"), waste: el("grid-waste"), style: el("grid-style")
} : null;
const automatic = { player: false, ally: true, ally2: true, ally3: true };

// Keep the two-person screen unchanged while adding extra fighter panels on demand.
function addFighterPanel(side, base) {
  const panel = el(`${base}-state`).cloneNode(true);
  panel.id = `${side}-state`;
  panel.querySelectorAll("[id]").forEach(child => {
    child.id = child.id.replace(base, side);
  });
  if (side.startsWith("ally")) panel.querySelector(".party-select").textContent = `味方${side.slice(4)}`;
  else panel.querySelector("b").textContent = `敵${side.slice(5)}`;
  panel.hidden = true;
  el("battle-main").querySelector(".arena").append(panel);

  const label = el(`${base}-belt-label`).cloneNode(true);
  const track = el(`${base}-belt`).cloneNode(true);
  label.id = `${side}-belt-label`;
  label.textContent = side.startsWith("ally") ? `味方${side.slice(4)}` : `敵${side.slice(5)}`;
  track.id = `${side}-belt`;
  track.replaceChildren();
  label.hidden = true;
  track.hidden = true;
  if (side.startsWith("enemy")) el("player-belt-label").before(label, track);
  else el("ally-belt").parentNode.append(label, track);
}
if (gridMode) {
  for (const [side, base] of [["ally2", "ally"], ["enemy3", "enemy2"], ["ally3", "ally"], ["enemy4", "enemy2"]]) {
    addFighterPanel(side, base);
  }
  const currentSize = sizeField.value || "1:1";
  const choices = [];
  for (let playerCount = 1; playerCount <= 4; playerCount++) {
    for (let enemyCount = 1; enemyCount <= 4; enemyCount++) {
      const option = document.createElement("option");
      option.value = `${playerCount}:${enemyCount}`;
      option.textContent = `${playerCount}対${enemyCount}`;
      choices.push(option);
    }
  }
  sizeField.replaceChildren(...choices);
  sizeField.value = currentSize;
}
let battle = newBattle();
let controlled = "player";
let targets = {};
let preparation = planningSeconds;
let planningTimer = null;
let battleTimer = null;
let largestHit = null;
const displayedHits = {};
const buttons = new Map();
const audio = createBattleAudio(el("battle-bgm"));
let renderGrid;
if (gridMode) {
  el("grid-panel").hidden = false;
  el("grid-instructions").hidden = false;
  el("player-control").hidden = false;
  el("grid-link").href = "../";
  el("grid-link").textContent = "通常のベルトライン戦闘";
  document.title = "外道不覚悟 | 戦闘VER4";
  el("battle-title").textContent = "ベルトライン戦闘 VER4";
  document.body.classList.add("grid-mode");
  renderGrid = bindBattleGrid({
    onMove: position => queue("move", position),
    onTarget: side => {
      targets[controlled] = side;
      const updated = setQueuedTarget(battle, controlled, side);
      el("input-status").textContent = updated
        ? `${fighterName(battle, controlled)}の次の攻撃 → ${fighterName(battle, side)}`
        : `次の攻撃対象 → ${fighterName(battle, side)}`;
      render();
    },
    onLanding: position => {
      if (setQueuedLanding(battle, controlled, position)) {
        el("input-status").textContent = `ジャンプ斬りの着地点 → ${cellName(position)}`;
        render();
      }
    },
    onSelect: selectFighter
  });
  el("grid-terrain").addEventListener("change", () => render());
  for (const side of PARTY_SIDES) {
    el(`${side}-select`).addEventListener("click", () => selectFighter(side));
    el(`${side}-mode`).addEventListener("click", () => {
      const enabled = !battle[side]?.automatic;
      if (!setAutomatic(battle, side, enabled)) return;
      automatic[side] = enabled;
      el("input-status").textContent = `${fighterName(battle, side)} · ${enabled ? "AUTO" : "手動"}`;
      render();
    });
  }
  for (const field of [sizeField, enemyChoiceField, columnsField, rowsField, ...Object.values(profileFields)]) field.addEventListener("change", () => {
    if (!canChooseProfile()) return;
    battle = newBattle();
    controlled = "player";
    targets = {};
    render();
  });
}

function newBattle() {
  if (!profileFields) return createBattle();
  const { risk, waste, style } = profileFields;
  const [players, enemies] = (sizeField.value || "1:1").split(":").map(Number);
  const columns = normalizeGridSize(columnsField.value);
  const rows = normalizeGridSize(rowsField.value);
  columnsField.value = columns;
  rowsField.value = rows;
  return createBattle(true, { risk: risk.value, waste: waste.value, style: style.value },
    { players, enemies, enemyName: enemyChoiceField.value === "hellor" ? "ヘルオル"
      : enemyChoiceField.value === "encounter" ? enemyName : undefined, automatic, columns, rows });
}

function canChooseProfile() {
  return battle.phase === "planning" && PARTY_SIDES.every(side => !battle[side]?.actions.length);
}

function selectFighter(side) {
  if (!battle[side]?.hp || battle.phase === "finished") return;
  controlled = side;
  el("input-status").textContent = `操作キャラ · ${fighterName(battle, side)}`;
  render();
}

for (const [id, command] of Object.entries(COMMANDS)) {
  const button = document.createElement("button");
  button.type = "button";
  if (command.color) button.className = command.color;
  button.append(command.name);
  const data = document.createElement("small");
  data.textContent = id === "wait" ? "TC 1 · SC 0 · 回復 +1"
    : `${command.tc}枠 ★${command.impact} · SC${command.sc} · Lv${command.level}`;
  button.append(data);
  if (command.requires) button.title = "直前にジャンプを予約してください";
  button.addEventListener("click", () => queue(id));
  buttons.set(id, button);
  el("commands").append(button);
}

function queue(id, destination) {
  if (!isManual(battle, controlled) || !reserve(battle, controlled, id, destination, targets[controlled])) return;
  audio.unlock();
  const message = destination ? `${cellName(destination)}への移動を予約（SC ${MOVE.sc}）。` : `${COMMANDS[id].name}を予約。`;
  el("input-status").textContent = battle.ally ? `${fighterName(battle, controlled)} · ${message}` : message;
  if (battle.phase === "planning") {
    audio.setMusic(true);
    if (!gridMode && planningTimer === null) {
      planningTimer = setInterval(() => {
        preparation--;
        if (preparation <= 0) launch();
        else render();
      }, 1000);
    }
  }
  render();
}

function launch() {
  if (battle.phase !== "planning") return;
  clearInterval(planningTimer);
  planningTimer = null;
  startBattle(battle);
  audio.setMusic(true);
  audio.play("start");
  playEnemyWarning(.26);
  battleTimer = setInterval(stepBattle, gridMode ? 1600 : 1000);
  render();
}

function playEnemyWarning(delay = 0) {
  const action = FOE_SIDES.filter(side => battle[side]).map(side => nextAction(battle, side))
    .find(next => next?.start === battle.tick + 1 && next.status === "pending" && warnings[next.commandId]);
  const warning = warnings[action?.commandId];
  if (warning) audio.play(warning, delay);
}

function playImpact() {
  const { player, enemy } = battle.lastHits;
  const received = player?.tick === battle.tick ? player : null;
  const dealt = enemy?.tick === battle.tick ? enemy : null;
  const hit = battle.grid?.roundHits.find(row => row.to === "player") ?? battle.grid?.roundHits[0] ?? received ?? dealt;
  if (!hit) return false;

  audio.play(hit.attack.color);
  if (hit.evading) audio.play("dodge", .05);
  else if (hit.guardFactor < 1) audio.play("guard", .05);
  else if (hit.clashWin) audio.play("clash", .05);
  else if (received) audio.play(hit.multiplier > 1 ? "critical" : "damage", .06);
  return true;
}

function stepBattle() {
  const recovery = nextRecovery(battle, controlled);
  const processed = renderGrid ? Object.fromEntries(gridSides(battle).map(side => [side, nextAction(battle, side)])) : null;
  advanceBattle(battle);
  for (const hit of battle.grid?.roundHits ?? []) {
    if (teamOf(hit.to) === "player" && hit.damage > (largestHit?.damage ?? 0)) largestHit = hit;
  }
  const impacted = playImpact();
  if (battle.phase === "finished") {
    clearInterval(battleTimer);
    audio.setMusic(false);
    audio.play(outcomeSounds[battle.outcome], impacted ? .35 : 0);
  } else {
    if (recovery.source === "待機" && (!recovery.full || recovery.reserved)) audio.play("recover", impacted ? .28 : 0);
    playEnemyWarning(impacted ? .28 : 0);
  }
  render(processed);
}

function slot(className, text) {
  const item = document.createElement("div");
  item.className = className;
  item.textContent = text;
  return item;
}

function makeTrack(actor, tick) {
  return Array.from({ length: TIMELINE_SIZE }, (_, i) => {
    const time = tick + i + 1;
    const action = actor.hp && actor.actions.find(item => item.start <= time && item.end >= time && item.status !== "stopped");
    if (!action) return slot("beat", "·");
    if (action.commandId === "move") {
      const text = action.destination ? `→${cellName(action.destination)}` : "追跡";
      const node = slot("beat movement-slot", text);
      node.title = `${time}枠目 ${text} · スタミナ ${MOVE.sc}消費`;
      return node;
    }
    if (action.commandId === "wait") {
      const node = slot("beat", "待機 +1");
      node.title = `${time}枠目 待機でスタミナを1回復`;
      return node;
    }
    const first = time === action.start;
    const impact = time === action.impact;
    const text = (first ? labels[action.commandId] : "") + (impact ? "★" : "");
    const strikeClass = impact ? i === 0 ? " strike imminent" : " strike" : "";
    const node = slot(`beat ${COMMANDS[action.commandId].color ?? ""}${strikeClass}`, text || "–");
    node.title = `${time}枠目 ${COMMANDS[action.commandId].name}${impact ? " インパクト" : ""}`;
    return node;
  });
}

function resources(actor) {
  const reserved = actor.recoveryReserved ? `（回復${actor.recoveryReserved}予約済み）` : "";
  return `HP ${actor.hp}/${actor.maxHp} · スタミナ ${actor.stamina}${reserved}`;
}

function commandName(command) {
  return command.color ? `${command.name}（${colorNames[command.color]}）` : command.name;
}

function renderFighter(side) {
  const pose = el(`${side}-pose`);
  const cue = el(`${side}-cue`);
  const action = battle.phase === "finished" ? null : nextAction(battle, side);
  const command = action && COMMANDS[action.commandId];
  const untilImpact = action ? action.impact - battle.tick : 0;

  let stage = "idle";
  let message = battle.phase === "finished" ? "戦闘終了" : "次の枠は空き";
  if (!battle[side].hp) {
    message = "戦闘不能";
  } else if (action?.commandId === "move") {
    message = action.destination ? `次の枠 · ${cellName(action.destination)}へ移動` : "次の枠 · 追跡";
  } else if (command) {
    if (action.status === "stopped") {
      message = `技が中断された · ${command.name}`;
    } else if (!command.damage) {
      message = `次の枠 · ${command.name}`;
    } else if (untilImpact > 1) {
      stage = "windup";
      message = `${commandName(command)} · ${windups[action.commandId]} · ★まであと${untilImpact}枠`;
    } else if (untilImpact === 1) {
      stage = "strike";
      message = `次の枠で★ · ${commandName(command)}（${action.impact}枠目）`;
    } else {
      stage = "recovery";
      message = `技の戻り中 · ${commandName(command)}`;
    }
  }

  if (pose) {
    pose.dataset.stage = stage;
    pose.dataset.move = action?.commandId ?? "";
    pose.dataset.color = command?.color ?? "";
  }
  cue.className = `cue ${command?.color ?? ""}`;
  cue.textContent = message;
}

function renderImpact(side) {
  const hits = battle.grid ? gridSides(battle).filter(id => teamOf(id) === side).map(id => battle.lastHits[id]).filter(Boolean) : [];
  const hit = hits.reduce((latest, row) => row.tick > latest.tick ? row : latest, hits[0]) ?? battle.lastHits[side];
  if (displayedHits[side] === hit) return;
  displayedHits[side] = hit;
  const panel = el(`${side}-impact`);
  if (!hit) {
    panel.textContent = side === "player" ? "まだ攻撃を受けていません。" : "";
    return;
  }

  const heading = slot("impact-time", `${hit.tick}枠目 · ${side === "player" ? "受けた攻撃" : "仕掛けた攻撃"}`);
  const target = hit.target ? `${commandName(hit.target)}${hit.afterImpact ? "の戻り中" : "中"}` : "空き枠";
  const attacker = hit.from ? fighterName(battle, hit.from) : side === "player" ? names.enemy : names.player;
  const defender = hit.to ? fighterName(battle, hit.to) : names[side];
  const row = slot("impact-row", `${attacker}の${commandName(hit.attack)} → ${defender}（${target}） · `);
  if (hit.evading) {
    row.append("回避成功");
  } else {
    const reason = hit.clashWin ? "同時発動で技を潰した" : hit.guardFactor < 1 ? "防御"
      : hit.multiplier > 1 ? "色相性で増加" : hit.multiplier < 1 ? "色相性で軽減" : "等倍";
    const factors = [hit.multiplier, hit.guardFactor].filter(factor => factor !== 1);
    const calculation = factors.length ? `（${hit.attack.damage} × ${factors.join(" × ")}）` : "";
    const damage = document.createElement("strong");
    damage.textContent = `${hit.damage}ダメージ`;
    row.append(damage, `${calculation} · ${reason}`);
  }
  panel.replaceChildren(heading, row);
}

function renderRecovery() {
  const cue = el("stamina-cue");
  const { source, committed, gain } = nextRecovery(battle, controlled);
  if (battle.ally) el("stamina-label").textContent = `${fighterName(battle, controlled)}の次の回復`;
  else el("stamina-label").textContent = "次のスタミナ回復";
  cue.className = "stamina-cue";
  if (!battle[controlled].hp && battle.phase !== "finished") {
    cue.textContent = `${fighterName(battle, controlled)}は戦闘不能`;
  } else if (battle.phase === "finished") {
    cue.textContent = "戦闘終了";
  } else if (!source) {
    cue.textContent = `${battle.tick + 1}枠目 · 行動中のため回復なし`;
  } else {
    const details = [gain ? `スタミナ +${gain}` : "", committed ? `${committed}を予約済みの技に充当` : ""].filter(Boolean);
    const recovery = details.join("、") || "満タン";
    cue.textContent = `${battle.tick + 1}枠目 · ${source} · ${recovery}`;
    if (details.length) cue.className += " recovering";
  }
}

function renderGridAdvice() {
  const panel = el("grid-defeat");
  panel.hidden = battle.outcome !== "敗北" || !largestHit;
  if (panel.hidden) return;
  const { tick, damage, target, attack, guardFactor, afterImpact } = largestHit;
  const retry = guardFactor < 1
    ? `その攻撃が届くマスから、${tick - 1}枠目までに離れる手を試してみましょう。`
    : `${tick}枠目に間合いを保って「防御」するか、${tick - 1}枠目までに範囲外へ移動してみましょう。`;
  const during = target ? `${commandName(target)}${afterImpact ? "の戻り中" : "中"}に` : "";
  el("grid-defeat-tip").textContent = `${tick}枠目に${during}${commandName(attack)}を受け、最大${damage}ダメージ。 ${retry}`;
}

function renderParty() {
  for (const side of PARTY_SIDES) {
    const actor = battle[side];
    const selected = !!actor && side === controlled;
    const mode = el(`${side}-mode`);
    const selector = el(`${side}-select`);
    const name = fighterName(battle, side);
    const inactive = !actor?.hp || battle.phase === "finished";
    mode.disabled = inactive;
    selector.disabled = inactive;
    mode.textContent = actor?.automatic ? "AUTO" : "手動";
    mode.setAttribute("aria-pressed", String(!!actor?.automatic));
    mode.setAttribute("aria-label", `${name}の自動操作`);
    selector.setAttribute("aria-pressed", String(selected));
    el(`${side}-belt`).classList.toggle("party-belt", selected);
    el(`${side}-belt-label`).classList.toggle("party-belt-label", selected);
  }
}

function render(processed) {
  if (!battle[controlled]?.hp) {
    controlled = PARTY_SIDES.find(side => battle[side]?.hp) ?? "player";
  }
  const sides = battle.grid ? gridSides(battle) : ["player", "enemy"];
  for (const side of sides) {
    el(`${side}-resources`).textContent = resources(battle[side]);
    renderFighter(side);
    el(`${side}-belt`).replaceChildren(...makeTrack(battle[side], battle.tick));
  }
  for (const side of ["ally", "ally2", "ally3", "enemy2", "enemy3", "enemy4"]) {
    el(`${side}-state`).hidden = !battle[side];
    el(`${side}-belt`).hidden = !battle[side];
    el(`${side}-belt-label`).hidden = !battle[side];
  }
  el("enemy-belt-label").textContent = battle.enemy2 ? "敵1" : "敵";
  el("battle-enemy-name").textContent = fighterName(battle, "enemy");
  for (const side of FOE_SIDES.slice(1)) {
    if (battle[side]) el(`battle-${side}-name`).textContent = fighterName(battle, side);
  }
  document.body.classList.toggle("large-party", sides.length >= 6);
  renderImpact("player");
  renderImpact("enemy");
  renderRecovery();
  const status = battle.phase === "finished" ? battle.outcome : battle.phase === "planning"
    ? planningTimer === null ? "コマンドを選んで初手を予約してください。" : `初手の入力 残り ${preparation} 秒`
    : `戦闘中 · ${battle.tick} 枠経過`;
  el("battle-status").textContent = gridMode && battle.phase === "planning"
    ? "技や移動を予約し、準備ができたら「戦闘開始」。" : status;
  if (renderGrid) {
    targets[controlled] = targetFor(battle, controlled, targets[controlled]);
    renderGrid(battle, processed, controlled, targets[controlled]);
    renderParty();
    renderGridAdvice();
    const editable = canChooseProfile();
    el("grid-personality").disabled = !editable;
    sizeField.disabled = !editable;
    enemyChoiceField.disabled = !editable;
    columnsField.disabled = !editable;
    rowsField.disabled = !editable;
    el("grid-profile-hint").textContent = editable
      ? "人数・マス目・敵の種類・性格は最初の予約前に変更できます。"
      : "人数・マス目・敵の種類・性格を変えるには「最初から」を押してください。";
  }
  el("time-axis").replaceChildren(...Array.from({length: TIMELINE_SIZE}, (_,i) => slot("beat-number", battle.tick + i + 1)));
  const manual = isManual(battle, controlled);
  el("commands").setAttribute("aria-label", `${fighterName(battle, controlled)}のコマンド入力`);
  for (const [id, button] of buttons) button.disabled = !manual || !canReserve(battle, controlled, id);
  el("start").hidden = battle.phase !== "planning";
  el("shift").disabled = !manual || !canShiftImpact(battle, controlled);
  el("battle-log").replaceChildren(...battle.events.map(text => {
    const entry = document.createElement("p");
    entry.textContent = text;
    return entry;
  }));
}

el("start").addEventListener("click", () => {
  audio.unlock();
  launch();
});
const soundButton = el("battle-sound");
soundButton.addEventListener("click", () => {
  const enabled = soundButton.getAttribute("aria-pressed") !== "true";
  soundButton.setAttribute("aria-pressed", String(enabled));
  el("battle-sound-state").textContent = enabled ? "ON" : "OFF";
  audio.setEnabled(enabled);
  if (enabled) audio.unlock();
});
document.addEventListener("visibilitychange", audio.syncMusic);
el("shift").title = `火炎の発生と後続を1枠遅らせる（スタミナ ${SHIFT_STAMINA}）`;
el("shift").addEventListener("click", () => {
  if (isManual(battle, controlled) && shiftImpact(battle, controlled)) {
    el("input-status").textContent = "火炎の発生を1枠遅らせました。";
    render();
  }
});
el("reset").addEventListener("click", () => {
  clearInterval(planningTimer);
  clearInterval(battleTimer);
  planningTimer = null;
  battleTimer = null;
  audio.setMusic(false);
  audio.stopEffects();
  preparation = planningSeconds;
  battle = newBattle();
  controlled = "player";
  targets = {};
  largestHit = null;
  el("input-status").textContent = "";
  render();
});
const fieldReturn = el("field-return");
if (urlParams.get("from") === "editor") fieldReturn.href = "../../?editorMap=1";
if (urlParams.get("from") && document.referrer) {
  const previous = new URL(document.referrer);
  if (previous.origin === window.location.origin && previous.pathname === new URL(fieldReturn.href, window.location.href).pathname) {
    fieldReturn.addEventListener("click", event => {
      event.preventDefault();
      window.history.back();
    });
  }
}
bindBattleFullscreen(el("battle-main"), el("battle-fullscreen"));
bindGameTaps(document);
render();
