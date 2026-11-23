import {
  MOVE, createGrid, gridSides, opposingSides, teamOf, targetFor, plannedPosition, PARTY_SIDES, FOE_SIDES,
  canStep, attackTargets, jumpLanding, jumpLandingCandidates, resolveMovement
} from "./grid-rules.js?v=7";
import { makeEnemyProfile, chooseEnemyAction } from "./grid-ai.js?v=5";

export const COMMANDS = Object.freeze({
  quick: { name: "通常攻撃", tc: 2, impact: 1, sc: 2, level: 1, color: "yellow", damage: 12 },
  heavy: { name: "強打", tc: 3, impact: 3, sc: 3, level: 1, color: "blue", damage: 20 },
  fire: { name: "火炎", tc: 5, impact: 3, sc: 4, level: 3, color: "red", damage: 26 },
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
const readableName = { player: "MAGE", enemy: "訓練用の見張り" };
const maxStamina = 12;

function participant(hp) {
  return { hp, maxHp: hp, stamina: maxStamina, recoveryReserved: 0, actions: [] };
}

export function createBattle(withGrid = false, enemyProfile, gridOptions = {}) {
  const battle = {
    tick: 0, phase: "planning", outcome: "", nextId: 1, enemyTurn: 0,
    player: participant(100), enemy: participant(100), events: [], lastHits: { player: null, enemy: null }
  };
  if (withGrid) {
    const players = Math.min(4, Math.max(1, Math.trunc(Number(gridOptions.players) || 1)));
    const enemies = Math.min(4, Math.max(1, Math.trunc(Number(gridOptions.enemies) || 1)));
    battle.grid = createGrid(players, enemies, gridOptions.columns, gridOptions.rows);
    battle.grid.enemyProfile = makeEnemyProfile(enemyProfile);
    battle.grid.enemyName = gridOptions.enemyName;
    for (const side of PARTY_SIDES.slice(1, players)) battle[side] = participant(100);
    for (const side of FOE_SIDES.slice(1, enemies)) battle[side] = participant(100);
    battle.player.automatic = gridOptions.automatic?.player === true;
    for (const side of PARTY_SIDES.slice(1, players)) {
      battle[side].automatic = gridOptions.automatic?.[side] !== false;
    }
  }
  planEnemy(battle);
  return battle;
}

function lastAction(actor) {
  return actor.actions.at(-1);
}

export function isManual(battle, side) {
  return teamOf(side) === "player" && !!battle[side]?.hp && !battle[side].automatic;
}

export function setAutomatic(battle, side, automatic) {
  if (!battle.grid || teamOf(side) !== "player" || !battle[side]?.hp || battle.phase === "finished") return false;
  battle[side].automatic = automatic;
  if (automatic && battle.phase === "running") planGridActor(battle, side);
  return true;
}

export function canReserve(battle, side, commandId, destination) {
  const actor = battle[side];
  if (!actor?.hp || battle.phase === "finished") return false;
  if (commandId === "move") {
    if (!battle.grid) return false;
    const from = teamOf(side) === "player" ? plannedPosition(battle, side) : battle.grid[side];
    if (!canStep(battle, side, from, destination)) return false;
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

export function reserve(battle, side, commandId, destination, targetSide) {
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
  if (battle.grid && command.damage && commandId !== "fire") {
    action.targetSide = targetFor(battle, side, targetSide, plannedPosition(battle, side));
    if (commandId === "jumpSlash" && action.targetSide) {
      action.landing = jumpLanding(battle, side, action.targetSide, plannedPosition(battle, side));
      action.manualLanding = false;
    }
  }
  actor.actions.push(action);
  return true;
}

// Only the next impact (or the first planned attack before launch) can be retargeted.
// The rest of the command queue remains intact.
export function editableAttack(battle, side) {
  if (!battle.grid || !isManual(battle, side) || battle.phase === "finished") return null;
  const candidates = battle[side].actions.filter(action => action.status === "pending"
    && (action.commandId === "quick" || action.commandId === "heavy" || action.commandId === "jumpSlash"));
  return battle.phase === "planning" ? (candidates[0] ?? null)
    : (candidates.find(action => action.impact === battle.tick + 1) ?? null);
}

export function setQueuedTarget(battle, side, target) {
  const action = editableAttack(battle, side);
  if (!action || !opposingSides(battle, side).includes(target)) return false;
  action.targetSide = target;
  if (action.commandId === "jumpSlash") {
    action.manualLanding = false;
    action.landing = jumpLanding(battle, side, target);
  }
  return true;
}

export function setQueuedLanding(battle, side, destination) {
  const action = editableAttack(battle, side);
  if (action?.commandId !== "jumpSlash" || !destination) return false;
  const target = targetFor(battle, side, action.targetSide);
  if (!target || !jumpLandingCandidates(battle, side, target)
    .some(cell => cell.x === destination.x && cell.y === destination.y)) return false;
  action.landing = { x: destination.x, y: destination.y };
  action.manualLanding = true;
  return true;
}

function shiftableFire(actor, tick) {
  return actor.actions.find(action => (
    action.commandId === "fire" && action.impact > tick && action.status === "pending" && !action.shifted
  ));
}

export function canShiftImpact(battle, side = "player") {
  const actor = battle[side];
  return battle.phase !== "finished" && !!actor?.hp && actor.stamina >= SHIFT_STAMINA && !!shiftableFire(actor, battle.tick)
    && lastAction(actor).end < battle.tick + TIMELINE_SIZE;
}

export function shiftImpact(battle, side = "player") {
  if (!canShiftImpact(battle, side)) return false;
  const actor = battle[side];
  const fire = shiftableFire(actor, battle.tick);
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
  if (battle.grid) planEnemy(battle);
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

function recoveryAmounts(actor) {
  const committed = Math.min(1, actor.recoveryReserved);
  const gain = Math.min(1 - committed, maxStamina - actor.stamina);
  return { committed, gain };
}

export function nextRecovery(battle, side = "player") {
  const action = nextAction(battle, side);
  const actor = battle[side];
  const { committed, gain } = recoveryAmounts(actor);
  return { source: recoverySource(action), reserved: committed > 0, full: actor.stamina >= maxStamina, committed, gain };
}

function resolveDependency(battle, side, action) {
  if (!action?.requiresId || action.start !== battle.tick || action.status !== "pending") return;
  const prerequisite = battle[side].actions.find(item => item.id === action.requiresId);
  if (prerequisite?.status !== "resolved") {
    action.status = "stopped";
    event(battle, `${fighterName(battle, side)}の${COMMANDS[action.commandId].name}は前提が崩れて不発。`);
  }
}

function attackAt(action, tick) {
  if (!action || action.status !== "pending" || action.impact !== tick) return null;
  const command = COMMANDS[action.commandId];
  return command?.damage ? command : null;
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

export function fighterName(battle, side) {
  if (side === "player") return readableName.player;
  if (PARTY_SIDES.includes(side)) return side === "ally" ? "味方" : `味方${side.slice(4)}`;
  const enemy = battle.grid?.enemyName || readableName.enemy;
  if (!FOE_SIDES.includes(side)) return side;
  const index = side === "enemy" ? 1 : Number(side.slice(5));
  return battle.enemy2 ? `${enemy}${index}` : enemy;
}

const allyProfile = makeEnemyProfile({ risk: "balanced", waste: "rarely", style: "hitRun" });

function planEnemy(battle) {
  if (battle.grid) {
    for (const side of gridSides(battle)) {
      if (teamOf(side) === "enemy" || (battle.phase === "running" && battle[side].automatic)) planGridActor(battle, side);
    }
    return;
  }
  while ((lastAction(battle.enemy)?.end ?? 0) < battle.tick + 8) {
    const action = enemySequence[battle.enemyTurn % enemySequence.length];
    if (!reserve(battle, "enemy", action)) break;
    battle.enemyTurn++;
  }
}

function incomingDamageAtNextSlot(battle, side) {
  let damage = 0;
  for (const id of opposingSides(battle, side)) {
    const current = activeAction(battle[id], battle.tick);
    const attack = attackAt(current, battle.tick + 1);
    if (attack && attackTargets(battle, id, current).includes(side)) damage += attack.damage;
  }
  return damage;
}

function planGridActor(battle, side) {
  const { grid } = battle;
  const actor = battle[side];
  if (!actor.hp || lastAction(actor)?.end > battle.tick) return;

  const target = targetFor(battle, side);
  if (!target) return;
  const canChoose = (id, destination) => canReserve(battle, side, id, destination);
  const choice = chooseEnemyAction({
    profile: teamOf(side) === "player" ? allyProfile : grid.enemyProfile,
    board: grid,
    from: grid[side], target: grid[target], previous: actor.previousAction, turn: actor.decision ?? 0,
    hp: actor.hp, stamina: actor.stamina, incomingDamage: incomingDamageAtNextSlot(battle, side)
  }, canChoose);
  if (reserve(battle, side, choice.id, choice.destination, target)) {
    actor.previousAction = choice.id;
    actor.decision = (actor.decision ?? 0) + 1;
  }
}

function recoverStamina(actor) {
  // Recovery first covers the cost of actions already booked after a wait.
  const { committed, gain } = recoveryAmounts(actor);
  actor.recoveryReserved -= committed;
  actor.stamina += gain;
}

function finishAction(actor, action, tick) {
  if (action?.status === "pending" && action.impact === tick) action.status = "resolved";
  if (recoverySource(action)) recoverStamina(actor);
  const needed = actor.actions.find(item => item.start === tick + 1)?.requiresId;
  actor.actions = actor.actions.filter(item => item.end > tick || item.id === needed
    || (item.commandId === "jump" && item === action && item.end === tick));
}

function resolveGridClashes(battle, sides, attacks, actions) {
  const stopped = new Set();
  const wins = new Map();
  for (const [index, side] of sides.entries()) {
    const a = attacks.get(side);
    if (!a) continue;
    for (const other of sides.slice(index + 1)) {
      const b = attacks.get(other);
      if (!a.targets.includes(other) || !b?.targets.includes(side)) continue;
      if (winsClash(a.command, b.command)) {
        stopped.add(other);
        wins.set(side, wins.get(side) ?? new Set());
        wins.get(side).add(other);
      } else if (winsClash(b.command, a.command)) {
        stopped.add(side);
        wins.set(other, wins.get(other) ?? new Set());
        wins.get(other).add(side);
      }
    }
  }
  for (const side of stopped) actions[side].status = "stopped";
  for (const [side, targets] of wins) {
    if (!stopped.has(side)) event(battle, `${fighterName(battle, side)}が${[...targets].map(id => fighterName(battle,id)).join("と")}の技を潰した。`);
  }
  return { stopped, wins };
}

function advanceGrid(battle, tick) {
  const sides = gridSides(battle).filter(side => battle[side].hp > 0);
  const actions = Object.fromEntries(sides.map(side => [side, activeAction(battle[side], tick)]));
  const attacks = new Map();
  for (const side of sides) {
    const action = actions[side];
    resolveDependency(battle, side, action);
    const command = attackAt(action, tick);
    if (!command) continue;
    const targets = attackTargets(battle, side, action);
    if (targets.length) attacks.set(side, { command, targets });
    else reportGrid(battle, `${fighterName(battle, side)}の${command.name}は相手が範囲におらず外れた。`);
  }

  const { stopped, wins } = resolveGridClashes(battle, sides, attacks, actions);
  const hits = [];
  const landings = new Map();
  for (const [side, { command, targets }] of attacks) {
    if (stopped.has(side)) continue;
    actions[side].performedTarget = targets[0];
    if (actions[side].commandId === "jumpSlash") {
      const cell = jumpLanding(battle, side, targets[0], battle.grid[side], actions[side].landing, actions[side].manualLanding);
      if (cell) {
        landings.set(side, cell);
        actions[side].performedLanding = cell;
      }
    }
    for (const target of targets) {
      const hit = assessHit(command, actions[target], tick, wins.get(side)?.has(target) ?? false);
      hits.push({ ...hit, tick, from: side, to: target });
    }
  }

  battle.grid.roundHits = hits;
  for (const side of sides) {
    const actor = battle[side];
    const action = actions[side];
    const incoming = hits.filter(hit => hit.to === side);
    if (incoming.length) battle.lastHits[side] = incoming.reduce((largest, hit) => hit.damage > largest.damage ? hit : largest);
    for (const { damage, evading } of incoming) {
      if (damage) {
        actor.hp = Math.max(0, actor.hp - damage);
        event(battle, `${fighterName(battle, side)}に ${damage} ダメージ。`);
        if (action?.commandId === "jump" && action.status === "pending") {
          action.status = "stopped";
          event(battle, `${fighterName(battle, side)}のジャンプが中断された。`);
        }
      } else if (evading) event(battle, `${fighterName(battle, side)}が攻撃を回避した。`);
    }
    finishAction(actor, action, tick);
  }

  const players = sides.some(side => teamOf(side) === "player" && battle[side].hp > 0);
  const enemies = sides.some(side => teamOf(side) === "enemy" && battle[side].hp > 0);
  if (!players || !enemies) {
    battle.phase = "finished";
    battle.outcome = players ? "勝利" : enemies ? "敗北" : "相打ち";
    return;
  }
  // Attacks use the positions at the start of the slot. Steps take effect afterwards.
  resolveMovement(battle, actions, landings, message => reportGrid(battle, message));
  planEnemy(battle);
}

export function advanceBattle(battle) {
  if (battle.phase !== "running") return;
  const tick = ++battle.tick;
  if (battle.grid) return advanceGrid(battle, tick);
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
    finishAction(actor, action, tick);
  }

  if (!battle.player.hp || !battle.enemy.hp) {
    battle.phase = "finished";
    battle.outcome = !battle.player.hp && !battle.enemy.hp ? "相打ち" : battle.player.hp ? "勝利" : "敗北";
    return;
  }
  planEnemy(battle);
}
