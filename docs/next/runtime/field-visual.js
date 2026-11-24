/**
 * FIELD NEXT: one character visual for grounded, jumping and aerial attacks.
 *
 * The original renderer has a separate drawAirborne() method that draws the
 * old, monolithic MAGE sheet. These injected adapters keep that code intact
 * for explicit legacy mode, but never select it while five-layer mode is on.
 */
import { nextContent, fieldMapFor } from "../content/index.js?v=3";
import { createLayeredCanvas } from "../../shared/modkit/layered-canvas.js";

export function createFieldVisualPort({
  content = nextContent,
  canvasLayers = createLayeredCanvas(),
  visualMode = () => document.getElementById("next-visual-mode")?.value || "layered"
} = {}) {
  const fieldGraphics = () => content.registry.get("characters","mage-next")?.graphics;
  const isLayered = () => visualMode() !== "legacy";

  const frameForFacing = Object.freeze({S:0,SE:1,E:2,NE:3,N:4,NW:5,W:6,SW:7});

  // During the five image downloads, keep drawing the SAME authentic MAGE
  // sheet. Never draw the temporary colored placeholder or another character.
  function draw(ctx, player, { elapsed=0, fallbackImage=null }={}) {
    if (!isLayered()) return false;
    const graphics=fieldGraphics();
    if (graphics?.mode!=="layered") return false;
    const bob=player.moving?Math.sin(elapsed*16)*1.8:0;
    // Normal scale now matches the 0.86x jump render from the previous version.
    // Keep the feet anchored to the same ground reference point.
    const w=68*.86,h=95*.86;
    const x=Math.round(player.x-w/2),y=Math.round(player.y-72*.86+bob*.86);
    if (!canvasLayers.draw(ctx,graphics,player.facing,x,y,w,h)
      && fallbackImage?.complete && fallbackImage.naturalWidth>0) {
      const frame=frameForFacing[player.facing]??0;
      ctx.save();
      ctx.imageSmoothingEnabled=false;
      ctx.drawImage(fallbackImage,
        (frame%4)*40,Math.floor(frame/4)*56,40,56,x,y,w,h);
      ctx.restore();
    }
    // Even before textures finish downloading, do not switch to a
    // mismatched third-party placeholder during takeoff/landing.
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
  TexturedRenderer, ArcaneFieldRenderer, ArcanePreviewRenderer, visualPort
}) {
  if (!TexturedRenderer?.prototype || !visualPort?.draw)
    throw new Error("FIELD NEXT visual port requires a renderer and draw function");

  const groundLegacy = TexturedRenderer.prototype.drawPlayer;
  TexturedRenderer.prototype.drawPlayer=function(player) {
    if (visualPort.draw(this.ctx,player,{elapsed:this.elapsed,fallbackImage:this.loaded?.("mage-8dir")})) return;
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
      // Ground draw is now already at the former jumping size (0.86x).
      // Do not shrink again during airborne rendering.
      // All five layers share the same subtle airborne tilt and transform.
      ctx.translate(player.x,player.y-30);
      ctx.rotate(-.08*Math.min(1,height/35));
      ctx.translate(-player.x,-player.y+30);
      visualPort.draw(ctx,player,{elapsed:this.elapsed,fallbackImage:this.loaded?.("mage-8dir")});
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
