/**
 * FIELD-side rendering and map port, injected into the bundled legacy engine
 * at the renderer seam. All simulation, controls, audio and save rules remain
 * the exact cloned implementation.
 */
import { nextContent, fieldMapFor } from "../content/index.js";
import { createLayeredCanvas } from "../../shared/modkit/layered-canvas.js";

export function createFieldVisualPort({
  content=nextContent,
  canvasLayers=createLayeredCanvas()
}={}) {
  const fieldGraphics=()=>content.registry.get("characters","mage-next")?.graphics;
  const enabled=()=>document.getElementById("next-visual-mode")?.value!=="legacy";
  function draw(ctx,player,{elapsed=0,airborne=false}={}) {
    if(!enabled())return false;
    const graphics=fieldGraphics();
    if(!graphics)return false;
    const bob=player.moving?Math.sin(elapsed*16)*1.8:0;
    const w=68,h=95;
    const x=Math.round(player.x-w/2),y=Math.round(player.y-72+bob);
    const alreadyAirborne=airborne ? -Math.max(0,window.__nextJumpOffset?.()||0) : 0;
    // Reuse the same 5 images and frame IDs in FIELD, BATTLE and EDITOR.
    // On a failed image load, allow the preserved legacy draw method to run.
    return canvasLayers.draw(ctx,graphics,player.facing,x,y+alreadyAirborne,w,h);
  }
  return Object.freeze({
    draw,
    mapFor(id){return fieldMapFor(id,content)},
    registry: content.registry
  });
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
