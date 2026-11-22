import { MOVE, createGrid, plannedPosition, canStep, prepareFire, attackReaches, resolveMovement } from "./grid-rules.js?v=2";
import { makeEnemyProfile, chooseEnemyAction } from "./grid-ai.js?v=1";

export const COMMANDS = Object.freeze({
  quick: { name: "通常攻撃", tc: 2, impact: 1, sc: 2, level: 1, color: "yellow", damage: 12 },
  heavy: { name: "強打", tc: 3, impact: 3, sc: 3, level: 1, color: "blue", damage: 20 },
  fire: { name: "火炎", tc: 5, impact: 3, sc: 1, level: 3, color: "red", damage: 26 },
  guard: { name: "防御", tc: 1, impact: 1, sc: 1, level: 0 },
  dodge: { name: "回避", tc: 2, impact: 2, sc: 3, level: 1 },
  jump: { name: "ジャンプ", tc: 2, impact: 2, sc: 1, level: 0 },
  jumpSlash: { name: "ジャンプ斬り", tc: 3, impact: 2, sc: 3, level: 2, color: "blue", damage: 24, requires: "jump" },
  wait: { name: "待機", tc: 1, impact: 1, sc: 0, level: 0 }
});

export const TIMELINE_SIZE = 12;
export const SHIFT_STAMINA = 2;
const advantage = { yellow: "blue", blue: "red", red: "yellow" };
const enemySequence = ["heavy", "fire", "quick", "guard"];
const gridEnemySequence = ["heavy", "fire", "move", "quick", "guard"];
const readableName = { player: "MAGE", enemy: "訓練用の見張り" };
const maxStamina = 12;

function participant(hp) {
  return { hp, maxHp: hp, stamina: maxStamina, recoveryReserved: 0, actions: [] };
}

export function createBattle(withGrid = false, enemyProfile) {
  const battle = {
    tick: 0, phase: "planning", outcome: "", nextId: 1, enemyTurn: 0,
    player: participant(100), enemy: participant(100), events: [], lastHits: { player: null, enemy: null }
  };
  if (withGrid) battle.grid = createGrid();
  if (withGrid && enemyProfile) battle.grid.enemyProfile = makeEnemyProfile(enemyProfile);
  planEnemy(battle);
  return battle;
}

function lastAction(actor) {
  return actor.actions.at(-1);
}

export function canReserve(battle, side, commandId, destination) {
  const actor = battle[side];
  if (battle.phase === "finished") return false;
  if (commandId === "move") {
    if (!battle.grid || (side === "player" && !canStep(plannedPosition(battle), destination, battle.grid.enemy))) return false;
    if (side === "enemy" && destination && !canStep(battle.grid.enemy, destination, battle.grid.player)) return false;
  } else if (!Object.hasOwn(COMMANDS, commandId)) {
    return false;
  }
  const command = commandId === "move" ? MOVE : COMMANDS[commandId];
  if (actor.stamina < command.sc) {
    const scheduledRecovery = actor.actions.filter(action =>
      action.commandId === "wait" && action.impact > battle.tick && action.status === "pending"
    ).length;
    if (actor.stamina + scheduledRecovery - actor.recoveryReserved < command.sc) return false;
  }
  const previous = lastAction(actor);
  const start = Math.max(battle.tick + 1, (previous?.end ?? battle.tick) + 1);
  if (start + command.tc - 1 > battle.tick + TIMELINE_SIZE) return false;
  return !command.requires || (previous?.commandId === command.requires && previous.end === start - 1 && previous.status !== "stopped");
}

export function reserve(battle, side, commandId, destination) {
  if (!canReserve(battle, side, commandId, destination)) return false;
  const actor = battle[side];
  const command = commandId === "move" ? MOVE : COMMANDS[commandId];
  const previous = lastAction(actor);
  const start = Math.max(battle.tick + 1, (previous?.end ?? battle.tick) + 1);
  const immediateCost = Math.min(actor.stamina, command.sc);
  actor.stamina -= immediateCost;
  actor.recoveryReserved += command.sc - immediateCost;
  const action = {
    id: battle.nextId++, commandId, start, impact: start + command.impact - 1, end: start + command.tc - 1,
    requiresId: command.requires ? previous.id : null, status: "pending", shifted: false
  };
  if (commandId === "move" && destination) action.destination = { x: destination.x, y: destination.y };
  actor.actions.push(action);
  if (battle.grid && battle.phase === "running" && start === battle.tick + 1) prepareFire(battle.grid, side, action);
  return true;
}

function shiftableFire(battle) {
  return battle.player.actions.find(action => (
    action.commandId === "fire" && action.impact > battle.tick && action.status === "pending" && !action.shifted
  ));
}

export function canShiftImpact(battle) {
  return battle.phase !== "finished" && battle.player.stamina >= SHIFT_STAMINA && !!shiftableFire(battle)
    && lastAction(battle.player).end < battle.tick + TIMELINE_SIZE;
}

export function shiftImpact(battle) {
  if (!canShiftImpact(battle)) return false;
  const actor = battle.player;
  const fire = shiftableFire(battle);
  fire.impact++;
  fire.end++;
  fire.shifted = true;
  for (const action of actor.actions) {
    if (action.start > fire.start) {
      action.start++;
      action.impact++;
      action.end++;
    }
  }
  actor.stamina -= SHIFT_STAMINA;
  event(battle, "火炎のインパクトを1枠後ろにずらした。");
  return true;
}

export function startBattle(battle) {
  if (battle.phase !== "planning") return;
  battle.phase = "running";
  prepareUpcomingFire(battle);
}

function activeAction(actor, tick) {
  return actor.actions.find(action => action.start <= tick && tick <= action.end);
}

export function nextAction(battle, side) {
  return activeAction(battle[side], battle.tick + 1);
}

function recoverySource(action) {
  if (!action) return "空き枠";
  if (action.commandId === "guard" || action.commandId === "wait") return COMMANDS[action.commandId].name;
  return null;
}

export function nextRecovery(battle) {
  const action = nextAction(battle, "player");
  const { stamina, recoveryReserved } = battle.player;
  return { source: recoverySource(action), reserved: recoveryReserved > 0, full: stamina >= maxStamina };
}

function resolveDependency(battle, side, action) {
  if (!action?.requiresId || action.start !== battle.tick || action.status !== "pending") return;
  const prerequisite = battle[side].actions.find(item => item.id === action.requiresId);
  if (prerequisite?.status !== "resolved") {
    action.status = "stopped";
    event(battle, `${readableName[side]}の${COMMANDS[action.commandId].name}は前提が崩れて不発。`);
  }
}

function prepareUpcomingFire(battle) {
  if (!battle.grid) return;
  for (const side of ["player", "enemy"]) prepareFire(battle.grid, side, nextAction(battle, side));
}

function attackAt(battle, side, action, tick) {
  if (!action || action.status !== "pending" || action.impact !== tick) return null;
  const command = COMMANDS[action.commandId];
  if (!command?.damage) return null;
  if (battle.grid && !attackReaches(battle.grid, side, action)) {
    reportGrid(battle, `${readableName[side]}の${command.name}は相手が範囲におらず外れた。`);
    return null;
  }
  return command;
}

function winsClash(a, b) {
  return a.color === b.color ? a.level >= b.level + 2 : advantage[a.color] === b.color && a.level >= b.level;
}

function colorMultiplier(attack, targetCommand) {
  if (!targetCommand?.color) return 1;
  if (advantage[attack.color] === targetCommand.color) return 1.5;
  if (advantage[targetCommand.color] === attack.color) return .7;
  return 1;
}

function assessHit(attack, targetAction, tick, clashWin) {
  if (!attack) return null;
  const target = targetAction?.commandId === "move" ? MOVE : targetAction ? COMMANDS[targetAction.commandId] : null;
  const guardFactor = targetAction?.commandId === "guard" ? .45 : 1;
  const evading = targetAction?.commandId === "dodge" && targetAction.impact === tick;
  const multiplier = clashWin ? 2 : colorMultiplier(attack, target);
  const damage = evading ? 0 : Math.round(attack.damage * multiplier * guardFactor);
  return { attack, target, afterImpact: !!targetAction && tick > targetAction.impact,
    clashWin, evading, multiplier, guardFactor, damage };
}

function event(battle, message) {
  battle.events.unshift(message);
  battle.events.length = Math.min(battle.events.length, 9);
}

function reportGrid(battle, message) {
  battle.grid.notice = `${battle.tick}枠目 · ${message}`;
  event(battle, message);
}

function planEnemy(battle) {
  if (battle.grid?.enemyProfile) {
    planGridEnemy(battle);
    return;
  }
  const sequence = battle.grid ? gridEnemySequence : enemySequence;
  while ((lastAction(battle.enemy)?.end ?? 0) < battle.tick + 8) {
    const action = sequence[battle.enemyTurn % sequence.length];
    if (!reserve(battle, "enemy", action)) break;
    battle.enemyTurn++;
  }
}

function planGridEnemy(battle) {
  const { grid, enemy, tick } = battle;
  if (enemy.actions.length) return;

  const current = activeAction(battle.player, tick);
  const damage = COMMANDS[current?.commandId]?.damage;
  const incomingDamage = current?.status === "pending" && current.impact === tick + 1
    && damage && attackReaches(grid, "player", current) ? damage : 0;
  const canChoose = (id, destination) => canReserve(battle, "enemy", id, destination);
  const choice = chooseEnemyAction({
    profile: grid.enemyProfile, from: grid.enemy, target: grid.player,
    previous: grid.previousEnemyAction, turn: battle.enemyTurn, hp: enemy.hp,
    stamina: enemy.stamina, incomingDamage
  }, canChoose);
  if (reserve(battle, "enemy", choice.id, choice.destination)) {
    grid.previousEnemyAction = choice.id;
    battle.enemyTurn++;
  }
}

function recoverStamina(actor) {
  // Recovery first covers the cost of actions already booked after a wait.
  if (actor.recoveryReserved > 0) actor.recoveryReserved--;
  else actor.stamina = Math.min(maxStamina, actor.stamina + 1);
}

export function advanceBattle(battle) {
  if (battle.phase !== "running") return;
  const tick = ++battle.tick;
  const playerAction = activeAction(battle.player, tick);
  const enemyAction = activeAction(battle.enemy, tick);
  resolveDependency(battle, "player", playerAction);
  resolveDependency(battle, "enemy", enemyAction);
  const playerAttack = attackAt(battle, "player", playerAction, tick);
  const enemyAttack = attackAt(battle, "enemy", enemyAction, tick);
  const playerWon = !!(playerAttack && enemyAttack && winsClash(playerAttack, enemyAttack));
  const enemyWon = !!(playerAttack && enemyAttack && winsClash(enemyAttack, playerAttack));
  if (playerWon || enemyWon) {
    const loser = playerWon ? enemyAction : playerAction;
    loser.status = "stopped";
    event(battle, `${readableName[playerWon ? "player" : "enemy"]}がインパクトを合わせ、相手の技を潰した。`);
  } else if (playerAttack && enemyAttack) {
    event(battle, "同時にインパクト。双方に攻撃が発生。");
  }

  const effects = [
    { side: "player", actor: battle.player, action: playerAction,
      hit: assessHit(playerWon ? null : enemyAttack, playerAction, tick, enemyWon) },
    { side: "enemy", actor: battle.enemy, action: enemyAction,
      hit: assessHit(enemyWon ? null : playerAttack, enemyAction, tick, playerWon) }
  ];
  for (const { side, actor, action, hit } of effects) {
    if (hit) battle.lastHits[side] = { tick, ...hit };
    const damage = hit?.damage;
    if (damage) {
      actor.hp = Math.max(0, actor.hp - damage);
      event(battle, `${readableName[side]}に ${damage} ダメージ。`);
      if (action?.commandId === "jump" && action.status === "pending") {
        action.status = "stopped";
        event(battle, `${readableName[side]}のジャンプが中断された。`);
      }
    } else if (hit?.evading) {
      event(battle, `${readableName[side]}が攻撃を回避した。`);
    }
    if (action?.status === "pending" && action.impact === tick) action.status = "resolved";
    if (recoverySource(action)) recoverStamina(actor);
    const needed = actor.actions.find(item => item.start === tick + 1)?.requiresId;
    actor.actions = actor.actions.filter(item => item.end > tick || item.id === needed ||
      (item.commandId === "jump" && item === action && item.end === tick));
  }

  if (!battle.player.hp || !battle.enemy.hp) {
    battle.phase = "finished";
    battle.outcome = !battle.player.hp && !battle.enemy.hp ? "相打ち" : battle.player.hp ? "勝利" : "敗北";
    return;
  }
  // Attacks use the positions at the start of the slot. Steps become effective for the next slot.
  if (battle.grid) resolveMovement(battle, playerAction, enemyAction, playerAttack && !enemyWon, message => reportGrid(battle, message));
  planEnemy(battle);
  prepareUpcomingFire(battle);
}
