import {
  COMMANDS, TIMELINE_SIZE, SHIFT_STAMINA, createBattle, canReserve, reserve,
  canShiftImpact, shiftImpact, startBattle, nextAction, nextRecovery, advanceBattle
} from "./rules.js?v=3";
import { createBattleAudio } from "./audio.js?v=1";

const el = id => document.getElementById(id);
const labels = { quick: "通常", heavy: "強打", fire: "火炎", guard: "防御", dodge: "回避", jump: "ジャンプ", jumpSlash: "空中斬り" };
const colorNames = { yellow: "黄", blue: "青", red: "赤" };
const windups = { quick: "踏み込み", heavy: "振りかぶり", fire: "詠唱中", jumpSlash: "空中で構え" };
const names = { player: "MAGE", enemy: "見張り" };
const warnings = { heavy: "heavyWarning", fire: "fireWarning" };
const outcomeSounds = { 勝利: "victory", 敗北: "defeat", 相打ち: "draw" };
const planningSeconds = 8;
let battle = createBattle();
let preparation = planningSeconds;
let planningTimer = null;
let battleTimer = null;
let largestHit = null;
const displayedHits = {};
const buttons = new Map();
const audio = createBattleAudio(el("battle-bgm"));

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
    audio.unlock();
    el("input-status").textContent = `${command.name}を予約。`;
    if (battle.phase === "planning" && planningTimer === null) {
      audio.setMusic(true);
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
  audio.setMusic(true);
  audio.play("start");
  playEnemyWarning(.26);
  battleTimer = setInterval(stepBattle, 1000);
  render();
}

function playEnemyWarning(delay = 0) {
  const action = nextAction(battle, "enemy");
  if (action?.start !== battle.tick + 1 || action.status !== "pending") return;
  const warning = warnings[action.commandId];
  if (warning) audio.play(warning, delay);
}

function playImpact() {
  const { player, enemy } = battle.lastHits;
  const received = player?.tick === battle.tick ? player : null;
  const dealt = enemy?.tick === battle.tick ? enemy : null;
  const hit = received ?? dealt;
  if (!hit) return false;

  audio.play(hit.attack.color);
  if (hit.evading) audio.play("dodge", .05);
  else if (hit.guardFactor < 1) audio.play("guard", .05);
  else if (hit.clashWin) audio.play("clash", .05);
  else if (received) audio.play(hit.multiplier > 1 ? "critical" : "damage", .06);
  return true;
}

function stepBattle() {
  const recovery = nextRecovery(battle);
  advanceBattle(battle);
  const received = battle.lastHits.player;
  if (received?.tick === battle.tick && received.damage > (largestHit?.damage ?? 0)) largestHit = received;
  const impacted = playImpact();
  if (battle.phase === "finished") {
    clearInterval(battleTimer);
    audio.setMusic(false);
    audio.play(outcomeSounds[battle.outcome], impacted ? .35 : 0);
  } else {
    if (recovery.source === "待機" && (!recovery.full || recovery.reserved)) audio.play("recover", impacted ? .28 : 0);
    playEnemyWarning(impacted ? .28 : 0);
  }
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
    const strikeClass = impact ? i === 0 ? " strike imminent" : " strike" : "";
    const node = slot(`beat ${COMMANDS[action.commandId].color ?? ""}${strikeClass}`, text || "–");
    node.title = `${time}枠目 ${COMMANDS[action.commandId].name}${impact ? " インパクト" : ""}`;
    return node;
  });
}

function resources(actor) {
  const reserved = actor.recoveryReserved ? `（待機の回復分を${actor.recoveryReserved}予約済み）` : "";
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
  if (command) {
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

  pose.dataset.stage = stage;
  pose.dataset.move = action?.commandId ?? "";
  pose.dataset.color = command?.color ?? "";
  cue.className = `cue ${command?.color ?? ""}`;
  cue.textContent = message;
}

function renderImpact(side) {
  const hit = battle.lastHits[side];
  if (displayedHits[side] === hit) return;
  displayedHits[side] = hit;
  const panel = el(`${side}-impact`);
  if (!hit) {
    panel.textContent = side === "player" ? "まだ攻撃を受けていません。" : "";
    return;
  }

  const heading = slot("impact-time", `${hit.tick}枠目 · ${side === "player" ? "受けた攻撃" : "仕掛けた攻撃"}`);
  const target = hit.target ? `${commandName(hit.target)}${hit.afterImpact ? "の戻り中" : "中"}` : "空き枠";
  const attacker = side === "player" ? names.enemy : names.player;
  const row = slot("impact-row", `${attacker}の${commandName(hit.attack)} → ${names[side]}（${target}） · `);
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
  const { source, reserved, full } = nextRecovery(battle);
  cue.className = "stamina-cue";
  if (battle.phase === "finished") {
    cue.textContent = "戦闘終了";
  } else if (!source) {
    cue.textContent = `${battle.tick + 1}枠目 · 行動中のため回復なし`;
  } else {
    const recovery = reserved ? "+1を予約済みの技に充当" : full ? "満タン" : "スタミナ +1";
    cue.textContent = `${battle.tick + 1}枠目 · ${source} · ${recovery}`;
    if (reserved || !full) cue.className += " recovering";
  }
}

function renderDefeatAdvice() {
  const panel = el("defeat-advice");
  panel.hidden = battle.outcome !== "敗北" || !largestHit;
  if (panel.hidden) return;

  const { attack, target, tick, damage, afterImpact, clashWin, multiplier, guardFactor } = largestHit;
  const timing = target ? `${commandName(target)}${afterImpact ? "の戻り中" : "中"}に` : "空き枠で";
  const reason = clashWin ? "同時に技を出した際、相手に技を潰されました。"
    : multiplier > 1 ? "色の相性でダメージが増えました。" : "";
  el("defeat-summary").textContent = `最も大きかった被弾は${tick}枠目。${timing}${commandName(attack)}を受けて${damage}ダメージ。${reason}`;

  let tip;
  if (target === COMMANDS.quick && afterImpact) {
    tip = `この通常攻撃を1回分減らし、${tick - 1}枠目に「待機」、${tick}枠目に「防御」を入れてみましょう。`;
  } else if (guardFactor < 1 || target === COMMANDS.dodge) {
    const dodgeStart = tick - COMMANDS.dodge.impact + 1;
    tip = `スタミナを${COMMANDS.dodge.sc}残して、${dodgeStart}枠目から「回避」を入れてみましょう。回避の★が${tick}枠目に重なれば、ダメージを受けずに済みます。`;
  } else {
    tip = `相手の★が出る${tick}枠目に「防御」を予約してみましょう。先に入れた技が重なるときは、その手前を「待機」で調整できます。`;
  }
  el("defeat-tip").textContent = tip;
}

function render() {
  el("player-resources").textContent = resources(battle.player);
  el("enemy-resources").textContent = resources(battle.enemy);
  renderFighter("player");
  renderFighter("enemy");
  renderImpact("player");
  renderImpact("enemy");
  renderRecovery();
  const status = battle.phase === "finished" ? battle.outcome : battle.phase === "planning"
    ? planningTimer === null ? "コマンドを選んで初手を予約してください。" : `初手の入力 残り ${preparation} 秒`
    : `戦闘中 · ${battle.tick} 枠経過`;
  el("battle-status").textContent = status;
  renderDefeatAdvice();
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
  audio.setMusic(false);
  audio.stopEffects();
  preparation = planningSeconds;
  battle = createBattle();
  largestHit = null;
  el("input-status").textContent = "";
  render();
});
render();
