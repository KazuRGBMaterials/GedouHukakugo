export const FIELD_OBJECT_LABELS = Object.freeze({ object: "置物", npc: "モブ（NPC）", enemy: "敵" });
export const FIELD_OBJECT_NAME_MAX = 40;
export const FIELD_OBJECT_DIALOGUE_MAX = 600;

const colors = { object: "#e6bf74", npc: "#87e0d1", enemy: "#f4a0ac" };
const talkReach = 52;

export function fieldObjectDetails(value) {
  const role = Object.hasOwn(FIELD_OBJECT_LABELS, value.role) ? value.role : "npc";
  const name = typeof value.name === "string"
    ? value.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, FIELD_OBJECT_NAME_MAX)
    : "";
  const dialogue = typeof value.dialogue === "string"
    ? value.dialogue.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, FIELD_OBJECT_DIALOGUE_MAX)
    : "";
  return { role, name: name || FIELD_OBJECT_LABELS[role], dialogue };
}

export function exampleFieldObjects() {
  return [
    { id: "sample-guide", type: "actor", x: 208, y: 504, w: 36, h: 32, solid: false,
      role: "npc", name: "道案内（サンプル）", dialogue: "この先に、古い遺跡があります。\n道をたどれば、入口が見えてきます。" },
    { id: "sample-sentry", type: "actor", x: 322, y: 419, w: 36, h: 32, solid: false,
      role: "enemy", name: "見張り（サンプル）", dialogue: "……ここを通るつもりか？" }
  ];
}

function dialoguePages(text) {
  return text.split("\n").map(line => line.trim()).filter(Boolean);
}

function distanceToObject({ x, y }, object) {
  const dx = Math.max(object.x - x, 0, x - object.x - object.w);
  const dy = Math.max(object.y - y, 0, y - object.y - object.h);
  return Math.hypot(dx, dy);
}

export function drawFieldObject(ctx, object) {
  const { x, y, w, h, role, name } = object;
  const size = Math.min(36, Math.max(8, Math.min(w, h)));
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.fillStyle = "#142036";
  ctx.strokeStyle = colors[role];
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (role === "object") {
    ctx.moveTo(0, -size * .45);
    ctx.lineTo(size * .43, 0);
    ctx.lineTo(0, size * .45);
    ctx.lineTo(-size * .43, 0);
    ctx.closePath();
  } else {
    ctx.arc(0, 0, size * .43, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colors[role];
  ctx.font = `bold ${Math.max(9, size * .44)}px system-ui`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText({ object: "◇", npc: "話", enemy: "敵" }[role], 0, 0);
  ctx.font = "bold 12px system-ui";
  ctx.textBaseline = "bottom";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#0d1324";
  ctx.strokeText(name, 0, -size / 2 - 3, 160);
  ctx.fillText(name, 0, -size / 2 - 3, 160);
  ctx.restore();
}

export function withFieldObjects(BaseRenderer, objects, dialogue) {
  return class extends BaseRenderer {
    render(player, world, elapsed) {
      super.render(player, world, elapsed);
      dialogue.update();
    }

    drawGround(world) {
      super.drawGround(world);
      for (const object of objects) drawFieldObject(this.ctx, object);
    }
  };
}

export class FieldDialogue {
  constructor(objects, getPlayer, ui) {
    this.entries = objects.map(object => ({ object, pages: dialoguePages(object.dialogue) }))
      .filter(entry => entry.pages.length);
    this.getPlayer = getPlayer;
    this.ui = ui;
    this.active = null;
    this.hinted = null;
    this.page = 0;
    ui.advance.addEventListener("click", () => this.confirm());
    ui.close.addEventListener("click", () => this.close());
  }

  nearest() {
    const player = this.getPlayer();
    let candidate = null;
    let range = talkReach;
    for (const entry of this.entries) {
      const distance = distanceToObject(player, entry.object);
      if (distance <= range && (!candidate || distance < range)) {
        candidate = entry;
        range = distance;
      }
    }
    return candidate;
  }

  update() {
    if (this.ui.blocked()) {
      this.close();
      this.showHint(null);
      return;
    }
    if (this.active && distanceToObject(this.getPlayer(), this.active.object) > talkReach) this.close();
    this.showHint(this.active ? null : this.nearest());
  }

  showHint(entry) {
    if (entry === this.hinted) return;
    this.hinted = entry;
    this.ui.hint.hidden = !entry;
    this.ui.hint.textContent = entry ? `A / PC：X で話す · ${entry.object.name}` : "";
  }

  confirm() {
    if (this.ui.blocked()) return false;
    if (this.active) {
      this.page++;
      if (this.page === this.active.pages.length) {
        this.close();
        return true;
      }
    } else {
      this.active = this.nearest();
      if (!this.active) return false;
      this.page = 0;
    }
    this.showHint(null);
    const { object, pages } = this.active;
    this.ui.name.textContent = object.name;
    this.ui.text.textContent = pages[this.page];
    this.ui.text.scrollTop = 0;
    this.ui.advance.textContent = this.page + 1 === pages.length ? "会話を終了" : "次へ";
    this.ui.panel.hidden = false;
    return true;
  }

  close() {
    if (!this.active) return false;
    this.active = null;
    this.ui.panel.hidden = true;
    return true;
  }
}
