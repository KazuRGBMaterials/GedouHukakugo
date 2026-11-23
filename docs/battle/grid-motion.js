import { GRID_COLUMNS, GRID_ROWS, targetFor, PARTY_SIDES, FOE_SIDES } from "./grid-rules.js?v=5";
import { nextAction } from "./rules.js?v=8";

const sides = [...PARTY_SIDES, ...FOE_SIDES];
const thrust = { quick: 9, heavy: 14, jumpSlash: 12 };
const offset = (from, to) => ({ x: to.x - from.x, y: to.y - from.y });
const shift = (x, y) => `translate(${x}px,${y}px)`;

function face(sprite, { x, y }) {
  if (!x && !y) return;
  const direction = (Math.round(Math.atan2(x, y) * 4 / Math.PI) + 8) % 8;
  sprite.style.backgroundPosition = `${-(direction % 4) * 30}px ${-Math.floor(direction / 4) * 42}px`;
}

function animate(element, transforms, duration) {
  element.animate?.(transforms.map(transform => ({ transform })), { duration, easing: "ease-out" });
}

function playAction(unit, action, heading, moved) {
  const { sprite, node, effect } = unit;
  const motion = thrust[action];
  if (motion) {
    const scale = Math.hypot(heading.x, heading.y) || 1;
    const x = heading.x / scale * motion;
    const y = heading.y / scale * motion;
    if (action !== "jumpSlash" || !moved) {
      animate(sprite, [shift(0, 0), shift(x, y - (action === "jumpSlash" ? 5 : 0)), shift(0, 0)], 280);
    }
    effect.style.transform = `rotate(${Math.atan2(heading.y, heading.x)}rad)`;
  }
  if (motion || action === "fire" || action === "guard" || action === "dodge") {
    node.dataset.acting = action;
    if (!motion) effect.style.transform = "";
    effect.animate?.([{ opacity: 0 }, { opacity: 1, offset: .24 }, { opacity: 0 }], 300);
  }
}

export function bindGridMotion(layer) {
  const units = sides.map(side => {
    const node = document.createElement("div");
    const sprite = document.createElement("span");
    const effect = document.createElement("span");
    node.className = `grid-unit grid-unit-${side}${side.startsWith("enemy") ? " grid-unit-enemy" : side.startsWith("ally") ? " grid-unit-ally" : ""}`;
    sprite.className = "grid-unit-sprite";
    effect.className = "grid-unit-effect";
    node.append(effect, sprite);
    layer.append(node);
    return { node, sprite, effect };
  });
  const motionPreference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let currentBattle;

  return (battle, processed) => {
    const reset = currentBattle !== battle;
    const previous = Object.fromEntries(units.map((unit, index) => {
      const side = sides[index];
      return [side, reset ? battle.grid[side] : unit.previous];
    }));
    currentBattle = battle;

    units.forEach((unit, index) => {
      const { node, sprite } = unit;
      const side = sides[index];
      const cell = battle.grid[side];
      node.hidden = !cell || ((battle.ally || battle.enemy2) && battle[side].hp === 0);
      if (!cell) {
        unit.previous = null;
        return;
      }
      const next = battle.phase === "running" ? nextAction(battle, side) : null;
      const command = processed?.[side];
      const performed = command?.status === "resolved" && command.impact === battle.tick;
      const from = previous[side] ?? cell;
      const travel = offset(from, cell);
      const moved = travel.x !== 0 || travel.y !== 0;
      const target = command?.performedTarget ?? command?.targetSide ?? targetFor(battle, side);
      const facing = previous[target] ? offset(from, previous[target]) : { x: 0, y: 1 };

      node.style.gridColumn = cell.x + 1;
      node.style.gridRow = cell.y + 1;
      node.classList.toggle("grid-unit-down", battle[side].hp === 0);
      node.dataset.stance = next?.status === "pending" ? next.commandId : "";
      if (reset || processed) {
        face(sprite, moved ? travel : facing);
        node.dataset.acting = "";
      }

      if (reset) {
        node.getAnimations?.().forEach(animation => animation.cancel());
        sprite.getAnimations?.().forEach(animation => animation.cancel());
        unit.effect.getAnimations?.().forEach(animation => animation.cancel());
      } else if (processed && !motionPreference?.matches) {
        if (moved) {
          const gap = Number.parseFloat(window.getComputedStyle?.(layer).gap) || 4;
          const x = -travel.x * (layer.clientWidth + gap) / GRID_COLUMNS;
          const y = -travel.y * (layer.clientHeight + gap) / GRID_ROWS;
          const trail = command?.commandId === "jumpSlash"
            ? [shift(x, y - 7), shift(x / 2, y / 2 - 13), shift(0, 0)] : [shift(x, y), shift(0, 0)];
          animate(node, trail, 240);
        }
        if (performed) playAction(unit, command.commandId, facing, moved);
        const hit = battle.lastHits[side];
        if (hit?.tick === battle.tick && hit.damage > 0) {
          sprite.animate?.([{ opacity: 1 }, { opacity: .45, offset: .2 }, { opacity: 1 }], 200);
        }
      }
      unit.previous = cell;
    });
  };
}
