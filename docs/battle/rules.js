export const COMMANDS = Object.freeze({
  quick: { name: "通常攻撃", tc: 2, impact: 1, sc: 2, level: 1, color: "yellow", damage: 12 },
  heavy: { name: "強打", tc: 3, impact: 3, sc: 3, level: 1, color: "blue", damage: 20 },
  fire: { name: "火炎", tc: 5, impact: 3, sc: 1, level: 3, color: "red", damage: 26 },
  guard: { name: "防御", tc: 1, impact: 1, sc: 1, level: 0 },
  dodge: { name: "回避", tc: 2, impact: 2, sc: 3, level: 1 },
  jump: { name: "ジャンプ", tc: 2, impact: 2, sc: 1, level: 0 },
  jumpSlash: { name: "ジャンプ斬り", tc: 3, impact: 2, sc: 3, level: 2, color: "blue", damage: 24, requires: "jump" }
});

export const TIMELINE_SIZE = 12;
export const SHIFT_STAMINA = 2;
const advantage = { yellow: "blue", blue: "red", red: "yellow" };
const enemySequence = ["heavy", "fire", "quick", "guard"];
const readableName = { player: "MAGE", enemy: "訓練用の見張り" };
const maxStamina = 12;

function participant(hp) {
  return { hp, maxHp: hp, stamina: maxStamina, actions: [] };
}

export function createBattle() {
  const battle = {
    tick: 0, phase: "planning", outcome: "", nextId: 1, enemyTurn: 0,
    player: participant(100), enemy: participant(100), events: []
  };
  planEnemy(battle);
  return battle;
}

function lastAction(actor) {
  return actor.actions.at(-1);
}

export function canReserve(battle, side, commandId) {
  const actor = battle[side];
  const command = COMMANDS[commandId];
  if (!Object.hasOwn(COMMANDS, commandId) || battle.phase === "finished" || actor.stamina < command.sc) return false;
  const previous = lastAction(actor);
  const start = Math.max(battle.tick + 1, (previous?.end ?? battle.tick) + 1);
  if (start + command.tc - 1 > battle.tick + TIMELINE_SIZE) return false;
  return !command.requires || (previous?.commandId === command.requires && previous.end === start - 1 && previous.status !== "stopped");
}

export function reserve(battle, side, commandId) {
  if (!canReserve(battle, side, commandId)) return false;
  const actor = battle[side];
  const command = COMMANDS[commandId];
  const previous = lastAction(actor);
  const start = Math.max(battle.tick + 1, (previous?.end ?? battle.tick) + 1);
  actor.stamina -= command.sc;
  actor.actions.push({
    id: battle.nextId++, commandId, start, impact: start + command.impact - 1, end: start + command.tc - 1,
    requiresId: command.requires ? previous.id : null, status: "pending", shifted: false
  });
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
  if (battle.phase === "planning") battle.phase = "running";
}

function activeAction(actor, tick) {
  return actor.actions.find(action => action.start <= tick && tick <= action.end);
}

function resolveDependency(battle, side, action) {
  if (!action?.requiresId || action.start !== battle.tick || action.status !== "pending") return;
  const prerequisite = battle[side].actions.find(item => item.id === action.requiresId);
  if (prerequisite?.status !== "resolved") {
    action.status = "stopped";
    event(battle, `${readableName[side]}の${COMMANDS[action.commandId].name}は前提が崩れて不発。`);
  }
}

function attackAt(action, tick) {
  if (!action || action.status !== "pending" || action.impact !== tick) return null;
  const command = COMMANDS[action.commandId];
  return command.damage ? command : null;
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

function hitAmount(attack, targetAction, tick, clashWin) {
  if (!attack) return 0;
  const targetCommand = targetAction && COMMANDS[targetAction.commandId];
  const guarding = targetAction?.commandId === "guard";
  const evading = targetAction?.commandId === "dodge" && targetAction.impact === tick;
  if (evading) return 0;
  const multiplier = clashWin ? 2 : colorMultiplier(attack, targetCommand);
  return Math.round(attack.damage * multiplier * (guarding ? .45 : 1));
}

function event(battle, message) {
  battle.events.unshift(message);
  battle.events.length = Math.min(battle.events.length, 9);
}

function planEnemy(battle) {
  while ((lastAction(battle.enemy)?.end ?? 0) < battle.tick + 8) {
    const action = enemySequence[battle.enemyTurn % enemySequence.length];
    if (!reserve(battle, "enemy", action)) break;
    battle.enemyTurn++;
  }
}

export function advanceBattle(battle) {
  if (battle.phase !== "running") return;
  const tick = ++battle.tick;
  const playerAction = activeAction(battle.player, tick);
  const enemyAction = activeAction(battle.enemy, tick);
  resolveDependency(battle, "player", playerAction);
  resolveDependency(battle, "enemy", enemyAction);
  const playerAttack = attackAt(playerAction, tick);
  const enemyAttack = attackAt(enemyAction, tick);
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
      damage: hitAmount(playerWon ? null : enemyAttack, playerAction, tick, enemyWon), incoming: !!enemyAttack && !playerWon },
    { side: "enemy", actor: battle.enemy, action: enemyAction,
      damage: hitAmount(enemyWon ? null : playerAttack, enemyAction, tick, playerWon), incoming: !!playerAttack && !enemyWon }
  ];

  for (const { side, actor, action, damage, incoming } of effects) {
    if (damage) {
      actor.hp = Math.max(0, actor.hp - damage);
      event(battle, `${readableName[side]}に ${damage} ダメージ。`);
      if (action?.commandId === "jump" && action.status === "pending") {
        action.status = "stopped";
        event(battle, `${readableName[side]}のジャンプが中断された。`);
      }
    } else if (incoming && action?.commandId === "dodge" && action.impact === tick) {
      event(battle, `${readableName[side]}が攻撃を回避した。`);
    }
    if (action?.status === "pending" && action.impact === tick) action.status = "resolved";
    if (!action || action.commandId === "guard") actor.stamina = Math.min(maxStamina, actor.stamina + 1);
    const needed = actor.actions.find(item => item.start === tick + 1)?.requiresId;
    actor.actions = actor.actions.filter(item => item.end > tick || item.id === needed ||
      (item.commandId === "jump" && item === action && item.end === tick));
  }

  if (!battle.player.hp || !battle.enemy.hp) {
    battle.phase = "finished";
    battle.outcome = !battle.player.hp && !battle.enemy.hp ? "相打ち" : battle.player.hp ? "勝利" : "敗北";
    return;
  }
  planEnemy(battle);
}
