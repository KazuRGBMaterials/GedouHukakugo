/**
 * FIELD NEXT: one character visual for grounded, jumping and aerial attacks.
 *
 * The original renderer has a separate drawAirborne() method that draws the
 * old, monolithic MAGE sheet. These injected adapters keep that code intact
 * for explicit legacy mode, but never select it while five-layer mode is on.
 */
import { nextContent, fieldMapFor } from "../content/index.js";
import { createLayeredCanvas } from "../../shared/modkit/layered-canvas.js";

export function createFieldVisualPort({
  content = nextContent,
  canvasLayers = createLayeredCanvas(),
  visualMode = () => document.getElementById("next-visual-mode")?.value || "layered"
} = {}) {
  const fieldGraphics = () => content.registry.get("characters","mage-next")?.graphics;
  const isLayered = () => visualMode() !== "legacy";

  // Loading the transparent sheets must never flash a different character.
  // Until the sheets are ready, draw a small same-palette placeholder rather
  // than allowing the old MAGE drawing method to take over.
  function drawLoadingAvatar(ctx,x,y,w,h) {
    ctx.save();
    ctx.fillStyle="#30213d";
    ctx.fillRect(x+w*.23,y+h*.05,w*.54,h*.49); // hair
    ctx.fillStyle="#e5b489";
    ctx.fillRect(x+w*.31,y+h*.12,w*.38,h*.30); // skin
    ctx.fillStyle="#436f99";
    ctx.fillRect(x+w*.23,y+h*.46,w*.54,h*.34); // clothes
    ctx.fillStyle="#28384b";
    ctx.fillRect(x+w*.27,y+h*.78,w*.2,h*.18);
    ctx.fillRect(x+w*.53,y+h*.78,w*.2,h*.18);
    ctx.restore();
  }

  function draw(ctx, player, { elapsed=0 }={}) {
    if (!isLayered()) return false;
    const graphics=fieldGraphics();
    if (graphics?.mode!=="layered") return false;
    const bob=player.moving?Math.sin(elapsed*16)*1.8:0;
    const w=68,h=95;
    const x=Math.round(player.x-w/2),y=Math.round(player.y-72+bob);
    if (!canvasLayers.draw(ctx,graphics,player.facing,x,y,w,h)) {
      drawLoadingAvatar(ctx,x,y,w,h);
    }
    return true; // No legacy-actor fallback while layered mode is enabled.
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
  TexturedRenderer, ArcaneFieldRenderer, ArcanePreviewRenderer, visualPort
}) {
  if (!TexturedRenderer?.prototype || !visualPort?.draw)
    throw new Error("FIELD NEXT visual port requires a renderer and draw function");

  const groundLegacy = TexturedRenderer.prototype.drawPlayer;
  TexturedRenderer.prototype.drawPlayer=function(player) {
    if (visualPort.draw(this.ctx,player,{elapsed:this.elapsed})) return;
    return groundLegacy.call(this,player);
  };

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
      ctx.save();
      ctx.fillStyle="#070c1a66";
      ctx.beginPath();
      ctx.ellipse(player.x,player.y+height+8,16,5,0,0,Math.PI*2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(player.x,player.y);
      ctx.scale(this.characterScale || .86,this.characterScale || .86);
      ctx.translate(-player.x,-player.y);
      // All five layers share the same subtle airborne tilt and transform.
      ctx.translate(player.x,player.y-30);
      ctx.rotate(-.08*Math.min(1,height/35));
      ctx.translate(-player.x,-player.y+30);
      visualPort.draw(ctx,player,{elapsed:this.elapsed});
      ctx.restore();
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
