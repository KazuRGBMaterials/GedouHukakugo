import {
  COMMANDS, TIMELINE_SIZE, SHIFT_STAMINA, createBattle, canReserve, reserve,
  canShiftImpact, shiftImpact, startBattle, advanceBattle
} from "./rules.js?v=2";

const el = id => document.getElementById(id);
const labels = { quick: "通常", heavy: "強打", fire: "火炎", guard: "防御", dodge: "回避", jump: "ジャンプ", jumpSlash: "空中斬り" };
const planningSeconds = 8;
let battle = createBattle();
let preparation = planningSeconds;
let planningTimer = null;
let battleTimer = null;
const buttons = new Map();

for (const [id, command] of Object.entries(COMMANDS)) {
  const button = document.createElement("button");
  button.type = "button";
  if (command.color) button.className = command.color;
  button.append(command.name);
  const data = document.createElement("small");
  data.textContent = id === "wait" ? "TC 1 · SC 0 · 回復 +1"
    : `TC ${command.tc} · IMP ${command.impact} · SC ${command.sc} · LV ${command.level}`;
  button.append(data);
  if (command.requires) button.title = "直前にジャンプを予約してください";
  button.addEventListener("click", () => {
    if (!reserve(battle, "player", id)) return;
    el("input-status").textContent = `${command.name}を予約。`;
    if (battle.phase === "planning" && planningTimer === null) {
      planningTimer = setInterval(() => {
        preparation--;
        if (preparation <= 0) launch();
        else render();
      }, 1000);
    }
    render();
  });
  buttons.set(id, button);
  el("commands").append(button);
}

function launch() {
  if (battle.phase !== "planning") return;
  clearInterval(planningTimer);
  planningTimer = null;
  startBattle(battle);
  battleTimer = setInterval(() => {
    advanceBattle(battle);
    if (battle.phase === "finished") clearInterval(battleTimer);
    render();
  }, 1000);
  render();
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
    const action = actor.actions.find(item => item.start <= time && item.end >= time && item.status !== "stopped");
    if (!action) return slot("beat", "·");
    if (action.commandId === "wait") {
      const node = slot("beat", "待機 +1");
      node.title = `${time}枠目 待機でスタミナを1回復`;
      return node;
    }
    const first = time === action.start;
    const impact = time === action.impact;
    const text = (first ? labels[action.commandId] : "") + (impact ? "★" : "");
    const node = slot(`beat ${COMMANDS[action.commandId].color ?? ""}${impact ? " strike" : ""}`, text || "–");
    node.title = `${time}枠目 ${COMMANDS[action.commandId].name}${impact ? " インパクト" : ""}`;
    return node;
  });
}

function resources(actor) {
  const reserved = actor.recoveryReserved ? `（待機の回復分を${actor.recoveryReserved}予約済み）` : "";
  return `HP ${actor.hp}/${actor.maxHp} · スタミナ ${actor.stamina}${reserved}`;
}

function render() {
  el("player-resources").textContent = resources(battle.player);
  el("enemy-resources").textContent = resources(battle.enemy);
  const status = battle.phase === "finished" ? battle.outcome : battle.phase === "planning"
    ? planningTimer === null ? "コマンドを選んで初手を予約してください。" : `初手の入力 残り ${preparation} 秒`
    : `戦闘中 · ${battle.tick} 枠経過`;
  el("battle-status").textContent = status;
  el("time-axis").replaceChildren(...Array.from({length: TIMELINE_SIZE}, (_,i) => slot("beat-number", battle.tick + i + 1)));
  el("enemy-belt").replaceChildren(...makeTrack(battle.enemy, battle.tick));
  el("player-belt").replaceChildren(...makeTrack(battle.player, battle.tick));
  for (const [id, button] of buttons) button.disabled = !canReserve(battle, "player", id);
  el("start").hidden = battle.phase !== "planning";
  el("shift").disabled = !canShiftImpact(battle);
  el("battle-log").replaceChildren(...battle.events.map(text => {
    const entry = document.createElement("p");
    entry.textContent = text;
    return entry;
  }));
}

el("start").addEventListener("click", launch);
el("shift").title = `火炎の発生と後続を1枠遅らせる（スタミナ ${SHIFT_STAMINA}）`;
el("shift").addEventListener("click", () => {
  if (shiftImpact(battle)) {
    el("input-status").textContent = "火炎の発生を1枠遅らせました。";
    render();
  }
});
el("reset").addEventListener("click", () => {
  clearInterval(planningTimer);
  clearInterval(battleTimer);
  planningTimer = null;
  battleTimer = null;
  preparation = planningSeconds;
  battle = createBattle();
  el("input-status").textContent = "";
  render();
});
render();
