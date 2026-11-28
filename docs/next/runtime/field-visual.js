/**
 * FIELD NEXT: one character visual for grounded, jumping and aerial attacks.
 *
 * The original renderer has a separate drawAirborne() method that draws the
 * old, monolithic MAGE sheet. These injected adapters keep that code intact
 * for explicit legacy mode, but never select it while five-layer mode is on.
 */
import { nextContent, fieldMapFor } from "../content/index.js?v=6";
import { createLayeredCanvas } from "../../shared/modkit/layered-canvas.js?v=2";

// Visual-only change. World coordinates, collision body and skill hitboxes
// keep their existing dimensions. Bottom edge stays anchored at player.y+23.
export const FIELD_AVATAR_SIZE=Object.freeze({width:32,height:45,baselineOffset:23});

export function createFieldVisualPort({
  content = nextContent,
  canvasLayers = createLayeredCanvas(),
  visualMode = () => document.getElementById("next-visual-mode")?.value || "layered",
  avatarScale = () => Number(globalThis.document?.getElementById("next-avatar-scale")?.value||100)/100
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
  // Three genuine gait poses from AbilityFieldRenderer, remapped to five
  // independent layers. Walk, idle and jump share the same smaller size.
  const walkPoses = Object.freeze([
    {l:-3,r:2,ly:-3,ry:1,head:1,bob:-1},
    {l:0,r:0,ly:0,ry:0,head:0,bob:0},
    {l:2,r:-3,ly:1,ry:-3,head:-1,bob:-1}
  ]);
  function drawWalk(ctx,graphics,facing,x,y,w,h,time) {
    if(typeof canvasLayers.drawSegment!=="function")return false;
    const pose=walkPoses[Math.floor(Math.max(0,time)*10)%walkPoses.length];
    // Existing walk frame was 42×59. Scale articulated parts to the
    // FIELD_AVATAR_SIZE body, with no movement or collision changes.
    const dx=w/42,dy=h/59;
    const part=(sx,sy,sw,sh,tx,ty,tw,th)=>
      canvasLayers.drawSegment(ctx,graphics,facing,
        {x:sx,y:sy,w:sw,h:sh},
        {x:x+tx*dx,y:y+ty*dy,w:tw*dx,h:th*dy});
    const left=part(0,30,20,26,pose.l,32+pose.ly+pose.bob,21,27);
    const right=part(20,30,20,26,21+pose.r,32+pose.ry+pose.bob,21,27);
    const torso=part(0,0,40,33,pose.head,pose.bob,42,35);
    return left&&right&&torso;
  }
  function draw(ctx,player,{elapsed=0,walkingTime,airborne=false}={}) {
    if(!isLayered())return false;
    const graphics=fieldGraphics();
    if(graphics?.mode!=="layered")return false;
    const factor=Math.min(1.5,Math.max(0.7,Number(avatarScale())||1));
    const {baselineOffset}=FIELD_AVATAR_SIZE;
    const w=Math.round(FIELD_AVATAR_SIZE.width*factor);
    const h=Math.round(FIELD_AVATAR_SIZE.height*factor);
    const x=Math.round(player.x-w/2),y=Math.round(player.y-h+baselineOffset);
    const time=Number.isFinite(walkingTime)?walkingTime:elapsed;
    if(player.moving&&!airborne && drawWalk(ctx,graphics,player.facing,x,y,w,h,time))return true;
    canvasLayers.draw(ctx,graphics,player.facing,x,y,w,h);
    // During image loading never fall back to silver-haired legacy MAGE.
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
        if (visualPort.draw(ctx,player,{elapsed:this.elapsed,walkingTime:this.walkTimer})) return;
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
      visualPort.draw(ctx,player,{elapsed:this.elapsed,walkingTime:this.walkTimer,airborne:true});
    };
  }
}

export function setupFieldControls(port) {
  const mode=document.getElementById("next-visual-mode");
  const map=document.getElementById("next-map-choice");
  const open=document.getElementById("next-map-open");
  const saved="gedo-next-field-visual-mode-v1";
  // Cosmetic size preference is distinct from gameplay and save revisions.
  const sizeSlider=document.getElementById("next-avatar-scale");
  const sizeLabel=document.getElementById("next-avatar-scale-label");
  const sizeKey="gedo-next-field-avatar-scale-v1";
  if(sizeSlider){
    try{
      const persisted=Number(localStorage.getItem(sizeKey));
      if(Number.isFinite(persisted)&&persisted>=70&&persisted<=150)
        sizeSlider.value=String(persisted);
    }catch{}
    const updateSize=()=>{
      const value=Math.min(150,Math.max(70,Number(sizeSlider.value)||100));
      if(sizeLabel)sizeLabel.textContent=value+"%";
      try{localStorage.setItem(sizeKey,String(value));}catch{}
    };
    sizeSlider.addEventListener("input",updateSize);
    updateSize();
  }
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
