/**
 * FIELD NEXT: one character visual for grounded, jumping and aerial attacks.
 *
 * The original renderer has a separate drawAirborne() method that draws the
 * old, monolithic MAGE sheet. These injected adapters keep that code intact
 * for explicit legacy mode, but never select it while five-layer mode is on.
 */
import { nextContent, fieldMapFor } from "../content/index.js?v=6";
import { createLayeredCanvas } from "../../shared/modkit/layered-canvas.js";

export function createFieldVisualPort({
  content = nextContent,
  canvasLayers = createLayeredCanvas(),
  visualMode = () => document.getElementById("next-visual-mode")?.value || "layered"
} = {}) {
  const fieldGraphics = () => content.registry.get("characters","mage-next")?.graphics;
  const isLayered = () => visualMode() !== "legacy";

  // All states use exactly the same layered graphics. Do not fall back
  // to the old silver-haired source image while the new textures load.
  if (canvasLayers.load) {
    const graphics=fieldGraphics();
    for (const layer of Object.values(graphics?.layers || {})) {
      const src=typeof layer==="string"?layer:layer?.src;
      if(src)canvasLayers.load(src);
    }
  }
  function draw(ctx, player, { elapsed=0 }={}) {
    if (!isLayered()) return false;
    const graphics=fieldGraphics();
    if (graphics?.mode!=="layered") return false;
    const bob=player.moving?Math.sin(elapsed*16)*1.8:0;
    // Use the larger 68×95 draw scale on the ground and in the air.
    // Gameplay coordinates and collision boxes are unchanged.
    const w=68,h=95;
    const x=Math.round(player.x-w/2),y=Math.round(player.y-72+bob);
    canvasLayers.draw(ctx,graphics,player.facing,x,y,w,h);
    // Draw nothing until new colors are ready, never flash old colors.
    return true;
  }

  return Object.freeze({
    draw, isLayered,
    mapFor(id){return fieldMapFor(id,content);},
    registry:content.registry
  });
}

/**
 * All avatar paths receive the same injected graphic, including jumps.
 * Altitude is already subtracted by JumpRenderer/AerialSlashJumpRenderer
 * before ArcaneSkinRenderer.drawAirborne(player) is invoked; do NOT subtract
 * it again here. The old renderer remains available only in legacy mode.
 */
export function installFieldLayeredRenderers({
  TexturedRenderer, AbilityRenderer, SkillMotionRenderer,
  ArcaneFieldRenderer, ArcanePreviewRenderer, visualPort
}) {
  if (!TexturedRenderer?.prototype || !visualPort?.draw)
    throw new Error("FIELD NEXT visual port requires a renderer and draw function");

  // AbilityFieldRenderer overrides TexturedFieldRenderer.drawPlayer and
  // draws the old 42x59 silver-haired sheet directly. Patch that actual
  // entry point as well as the base renderer. SkillMotionFieldRenderer
  // wraps its superclass in a .86 scale; compensate only for the layered
  // body, leaving all skill-effect transforms and legacy mode untouched.
  const scaledGround = new WeakSet();
  if (SkillMotionRenderer?.prototype?.drawPlayer) {
    const motionLegacy=SkillMotionRenderer.prototype.drawPlayer;
    SkillMotionRenderer.prototype.drawPlayer=function(player) {
      if (!visualPort.isLayered()) return motionLegacy.call(this,player);
      scaledGround.add(this);
      try { return motionLegacy.call(this,player); }
      finally { scaledGround.delete(this); }
    };
  }
  function shadow(ctx,x,y) {
    ctx.save();
    ctx.fillStyle="#070c1a66";
    ctx.beginPath();
    ctx.ellipse(x,y+8,16,5,0,0,Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
  for (const Renderer of [TexturedRenderer, AbilityRenderer]) {
    if (!Renderer?.prototype?.drawPlayer) continue;
    const groundLegacy=Renderer.prototype.drawPlayer;
    Renderer.prototype.drawPlayer=function(player) {
      if (!visualPort.isLayered()) return groundLegacy.call(this,player);
      const ctx=this.ctx;
      const scale=scaledGround.has(this)?Number(this.characterScale):1;
      ctx.save();
      try {
        if (Number.isFinite(scale) && scale>0 && scale!==1) {
          ctx.translate(player.x,player.y);
          ctx.scale(1/scale,1/scale);
          ctx.translate(-player.x,-player.y);
        }
        shadow(ctx,player.x,player.y);
        if (visualPort.draw(ctx,player,{elapsed:this.elapsed})) return;
      } finally { ctx.restore(); }
      return groundLegacy.call(this,player);
    };
  }

  for (const Renderer of [ArcaneFieldRenderer,ArcanePreviewRenderer]) {
    if (!Renderer?.prototype?.drawAirborne) continue;
    const airborneLegacy=Renderer.prototype.drawAirborne;
    Renderer.prototype.drawAirborne=function(player) {
      if (!visualPort.isLayered()) return airborneLegacy.call(this,player);
      const height=Math.max(0,Number(
        this.skills?.aerialSlash?.height ?? this.actions?.jumpOffset?.() ?? 0
      )||0);
      const ctx=this.ctx;
      // The shadow stays on the ground, while JumpRenderer has already
      // raised the character's drawing coordinate by exactly height.
      shadow(ctx,player.x,player.y+height);

      // The jump renderer has already raised the position. Do not apply
      // another scale, tint or rotation; standing and jumping must match.
      visualPort.draw(ctx,player,{elapsed:this.elapsed});
    };
  }
}

export function setupFieldControls(port) {
  const mode=document.getElementById("next-visual-mode");
  const map=document.getElementById("next-map-choice");
  const open=document.getElementById("next-map-open");
  const saved="gedo-next-field-visual-mode-v1";
  try { if(localStorage.getItem(saved)==="legacy")mode.value="legacy"; }catch{}
  mode?.addEventListener("change",()=>{
    try{localStorage.setItem(saved,mode.value);}catch{}
  });
  const maps=port.registry.list("maps").filter(def=>def.file);
  map.replaceChildren(...maps.map(def=>{
    const option=document.createElement("option");
    option.value=def.id;option.textContent=def.displayName;return option;
  }));
  const active=new URLSearchParams(location.search).get("map");
  if(active && port.mapFor(active))map.value=active;
  open?.addEventListener("click",()=>{
    const id=map?.value;
    if(!id||!port.mapFor(id))return;
    const dest=new URL(location.href);
    dest.searchParams.delete("editorMap");
    dest.searchParams.set("map",id);
    location.assign(dest.href);
  });
}
