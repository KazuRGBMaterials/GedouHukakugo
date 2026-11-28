import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import {fileURLToPath} from "node:url";
import { nextContent, graphicsForBattle, fieldMapFor, objectDefinitionFor, createNextContent } from "../content/index.js";
import { createLayeredCanvas } from "../../shared/modkit/layered-canvas.js";
import { createFieldVisualPort, installFieldLayeredRenderers, FIELD_AVATAR_SIZE } from "../runtime/field-visual.js";
import { lobby,prepareBattle,applyIntent,beginBattle,tickBattle,ownedSide } from "../battle/online/belt-engine.js";
import {victoryFanfare,createVictoryGate} from "../battle/victory-fanfare.js";
import {shareInvite} from "../runtime/invite-share.js";
import { motionPacket,attackPatch,recentAttackEvents } from "../runtime/field-sync.js";
import { FieldCombat, attackPacket } from "../runtime/field-combat.js";
import { summarizeFieldStatus } from "../runtime/field-status.js";
import { createDefinitionRegistry } from "../../shared/modkit/definition-registry.js";
import { validateMap, STORAGE_KEY } from "../editor/map-schema.js";
import { createBattle, startBattle, advanceBattle } from "../../battle/rules.js";
import { createBattleAI } from "../../battle/content/ai-services.js";
import { WAIT_HEAL_HP, withWaitHealthRecovery } from "../battle/rest-recovery.js";

const dir=path.dirname(fileURLToPath(import.meta.url));
const docs=path.resolve(dir,"../..");
const next=path.resolve(dir,"..");
const run=(name,fn)=>{fn();console.log("PASS",name);};
const text = p=>fs.readFileSync(path.resolve(next,p),"utf8");

run("original entry files remain available",()=>{
 for(const p of ["index.html","battle/index.html","editor/index.html"]){
  assert(fs.existsSync(path.join(docs,p)),p);
 }
});
run("NEXT entry files are independent copies",()=>{
 for(const p of ["index.html","battle/index.html","editor/index.html"]){
  assert(fs.existsSync(path.join(next,p)),p);
  assert.notEqual(text(p),fs.readFileSync(path.join(docs,p),"utf8"));
 }
});
run("all three entry pages expose NEXT version and entry",()=>{
 assert.match(text("index.html"),/FIELD NEXT v1\.0/);
 assert.match(text("battle/index.html"),/戦闘 NEXT/);
 assert.match(text("editor/index.html"),/FIELD EDITOR NEXT/);
});
run("FIELD embedded TypeScript modules all parse",()=>{
 const html=text("index.html");
 const match=html.match(/const modules=(\{[\s\S]*?\});\s*const cache=/);
 assert(match,"CJS bundle is missing");
 const modules=JSON.parse(match[1]);
 assert(Object.keys(modules).length>=35);
 for(const [name,source] of Object.entries(modules)){
   try{new Function("require","module","exports",source);}catch(e){throw Error(name+": "+e.message);}
 }
 assert.match(modules["/src/editor/PreviewMap.ts"],/gedo-next-field-editor-autosave-v1/);
 assert.match(modules["/src/save/LocalFieldSaveRepository.ts"],/gedo-next-field-save-v1/);
 const script=html.match(/<script type="module">([\s\S]*?)<\/script>/);
 assert(script,"module boot script missing");
 new vm.SourceTextModule(script[1]);
});
run("current and NEXT local-save keys are isolated",()=>{
 assert.equal(STORAGE_KEY,"gedo-next-field-editor-autosave-v1");
 const editor=text("editor/editor.js");
 assert.match(editor,/localStorage\.getItem\("gedo-field-editor-autosave-v1"\)/);
 assert(!editor.includes('localStorage.setItem("gedo-field-editor-autosave-v1"'));
});
run("map and characters resolve from a single DI registry",()=>{
 const scene=fieldMapFor("field-starter");
 assert.equal(scene.schema,"gedo-field-map");
 assert.equal(scene.version,1);
 assert(scene.objects.length>0);
 assert.equal(nextContent.registry.get("characters","mage-next").graphics.mode,"layered");
 assert.equal(nextContent.registry.get("enemies","hellor").ai,"hellor");
 assert.equal(nextContent.registry.get("objects","tree-tall").fieldType,"tree");
 assert.equal(graphicsForBattle("player",{}).mode,"layered");
 assert.equal(graphicsForBattle("enemy",{grid:{enemyType:"hellor"}}).mode,"legacy");
 assert.equal(objectDefinitionFor("tree-tall").defaultSize[0],84);
});
run("both one-file and multi-entry DI registration work",()=>{
 const registry=createDefinitionRegistry({packs:[
  {kind:"characters",id:"single"},
  {characters:[{id:"combined"}],objects:[{id:"stone"}]}
 ]});
 assert(registry.has("characters","single") && registry.has("characters","combined"));
 assert(registry.has("objects","stone"));
});
run("layered sprites share frame + order on canvas",()=>{
 const calls=[];
 class ImageMock {
  complete=true;naturalWidth=120;
  set src(value){this._src=value;}
 }
 const gfx=nextContent.registry.get("characters","mage-next").graphics;
 const ctx={save(){calls.push("save");},restore(){calls.push("restore");},
  set imageSmoothingEnabled(v){calls.push(["smooth",v]);},
  set globalAlpha(v){calls.push(["alpha",v]);},
  drawImage(...args){calls.push(["draw",...args]);}};
 const r=createLayeredCanvas({imageFactory:()=>new ImageMock()});
 assert.equal(r.draw(ctx,gfx,"NE",10,20,35,50),true);
 const draw=calls.filter(x=>Array.isArray(x)&&x[0]==="draw");
 assert.equal(draw.length,5);
 assert.equal(gfx.width,40);
 assert.equal(gfx.height,56);
 assert(draw.every(row=>row[2]===120&&row[3]===0&&row[4]===40&&row[5]===56));
});
run("segmented 5-layer renderer crops the same frame for each clothing layer",()=>{
 const calls=[];
 class ImageMock {complete=true;naturalWidth=160;set src(value){this._src=value;}}
 const draw=createLayeredCanvas({imageFactory:()=>new ImageMock()});
 const graphics=nextContent.registry.get("characters","mage-next").graphics;
 const ctx={save(){},restore(){},set imageSmoothingEnabled(_){},
   set globalAlpha(_){},drawImage(...args){calls.push(args);}};
 assert.equal(draw.drawSegment(ctx,graphics,"SW",
   {x:20,y:30,w:20,h:26},{x:20,y:45,w:34,h:43}),true);
 assert.equal(calls.length,5);
 for(const args of calls){
   assert.equal(args[1],140); // SW frame#7 at x 120 plus right leg x 20
   assert.equal(args[2],86); // SW second row at y 56 plus leg y 30
   assert.equal(args[3],20);
   assert.equal(args[4],26);
   assert.equal(args[5],20);
   assert.equal(args[7],34);
 }
 assert.equal(draw.drawSegment(ctx,graphics,"S",
   {x:32,y:50,w:9,h:6},{x:1,y:1,w:10,h:10}),false,
   "Prevent drawing a region beyond native sprite boundary");
});
run("FIELD NEXT three gait poses move the legs, not slide a static body",()=>{
 const segments=[],full=[];
 const canvasLayers={
   draw(ctx,graphics,facing,x,y,w,h){full.push({graphics,facing,x,y,w,h});return true;},
   drawSegment(ctx,graphics,facing,source,destination){
     segments.push({graphics,facing,source,destination});return true;
   }
 };
 const port=createFieldVisualPort({
   canvasLayers,visualMode:()=>"layered"
 });
 const actor={x:160,y:180,facing:"NE",moving:true};
 for(const time of [0,.11,.21]){
   const before=segments.length;
   assert.equal(port.draw({},actor,{walkingTime:time}),true);
   assert.equal(segments.length,before+3);
 }
 assert.equal(full.length,0,"Walking must use articulated pieces instead of full static sprite");
 for(let frame=0;frame<3;frame++){
   const three=segments.slice(frame*3,frame*3+3);
   assert.equal(three[0].source.x,0);
   assert.equal(three[0].source.y,30);
   assert.equal(three[1].source.x,20);
   assert.equal(three[1].source.y,30);
   assert.equal(three[2].source.y,0);
   assert(three.every(row=>row.graphics===three[0].graphics&&row.facing==="NE"),
     "All five layer pieces must use the same character and facing");
 }
 assert.notEqual(segments[0].destination.x,segments[3].destination.x);
 assert.notEqual(segments[1].destination.x,segments[4].destination.x);
 assert.notEqual(segments[0].destination.y,segments[3].destination.y);
 assert.notEqual(segments[6].destination.x,segments[3].destination.x);
 const now=segments.length;
 port.draw({}, {...actor,moving:false},{walkingTime:.31});
 assert.equal(segments.length,now,"Stopping must restore full idle frame");
 assert.equal(full.length,1);
 port.draw({},actor,{walkingTime:.41,airborne:true});
 assert.equal(segments.length,now,"Jumping while moving must not play ground walk cycle");
 assert.equal(full.length,2);
 assert.equal(full[0].w,FIELD_AVATAR_SIZE.width);
 assert.equal(full[0].h,FIELD_AVATAR_SIZE.height);
});
run("FIELD NEXT renders compact 32×45 MAGE while preserving standing baseline",()=>{
 assert.deepEqual(FIELD_AVATAR_SIZE,{width:32,height:45,baselineOffset:23});
 const frames=[];
 const port=createFieldVisualPort({
  canvasLayers:{draw(_ctx,_gfx,_face,x,y,w,h){frames.push({x,y,w,h});return true;}},
  visualMode:()=>"layered"
 });
 const player={x:120,y:160,facing:"S",moving:false};
 port.draw({},player);
 assert.deepEqual(frames[0],{x:104,y:138,w:32,h:45});
 assert.equal(frames[0].y+frames[0].h,183,
  "Body bottom must stay at world position +23 (hitbox stays unchanged)");
});
run("FIELD NEXT X-menu status reads actual movement and skill, and marks combat numbers provisional",()=>{
 const status=summarizeFieldStatus({
  player:{x:219.7,y:330.8,facing:"NE",moving:true},
  hudText:"SKILL 3 · レーザー",query:"?map=old-town"
 });
 assert.deepEqual(status,{
  position:"X 220 / Y 331",facing:"北東",action:"移動中",
  skill:"レーザー",field:"old-town"
 });
 assert.equal(summarizeFieldStatus({}).position,"取得待ち");
 assert.equal(summarizeFieldStatus({player:{x:1,y:2,facing:"W",moving:false},
   hudText:"SKILL 4 · 突撃",query:"?editorMap=1"}).field,"エディタ試遊");
 const html=text("index.html");
 assert(html.includes('./next/runtime/field-status.css?v=1'));
 assert(html.includes('./next/runtime/field-status.js?v=3'));
 assert(html.includes('field-visual.js?v=11'));
 const source=text("runtime/field-status.js");
 assert(source.includes("Lv・HP・MPは既存HUDに合わせた仮表示"));
 assert(source.includes('doc.getElementById("game-menu")'));
});
run("FIELD NEXT avatar slider changes only visual size without moving player feet",()=>{
 const rows=[];
 const port=createFieldVisualPort({
  canvasLayers:{draw(_ctx,_gfx,_dir,x,y,w,h){rows.push({x,y,w,h});return true;}},
  visualMode:()=>"layered",
  avatarScale:()=>1.5
 });
 const player={x:120,y:160,facing:"S",moving:false};
 assert.equal(port.draw({},player),true);
 assert.deepEqual(rows[0],{x:96,y:115,w:48,h:68});
 assert.equal(rows[0].y+rows[0].h,player.y+FIELD_AVATAR_SIZE.baselineOffset);
 const html=text("index.html");
 assert(html.includes('id="next-avatar-scale"'));
 assert(html.includes('field-controls-responsive.css?v=4'));
 const css=text("runtime/field-controls-responsive.css");
 for(const term of [
  "grid-template-columns:repeat(3,var(--field-face))",
  "grid-template-rows:repeat(3,var(--field-face))",
  "position:static!important",
  "clip-path:none!important",
  "grid-row:1;grid-column:2",
  "grid-row:2;grid-column:1",
  "grid-row:2;grid-column:3",
  "grid-row:3;grid-column:2",
  "@media (max-height:600px)",
  "@media (max-width:480px)"
 ])assert(css.includes(term),"Missing responsive rule "+term);
 const grid=(side,gap)=>side*3+gap*2;
 for(const [side,gap,panel] of [[58,8,216],[52,6,184],[44,5,160],[42,5,150]])
  assert(grid(side,gap)<=panel,"Four face-buttons must fit their own panel");
});
run("FIELD NEXT Safari 100% menu uses full frame and permits native touch scrolling",()=>{
 const html=text("index.html");
 const opening=html.indexOf('id="game-menu"');
 const close=html.indexOf('id="menu-close"',opening);
 const settings=html.indexOf('id="next-visual-mode"',opening);
 assert(opening>0&&close>opening&&close<settings);
 assert.equal((html.match(/id="menu-close"/g)||[]).length,1);
 assert(html.includes('field-controls-responsive.css?v=4'));
 assert(html.includes("event.target.closest('#game-menu')"));
 const css=text("runtime/field-controls-responsive.css");
 for(const fragment of [
  ".game-menu .menu-toolbar","position:sticky;top:0",
  "game-menu .menu-toolbar #menu-close",
  "#app, #app .game-frame{touch-action:pan-y;}",
  "#app #field, #app .game-frame .control-panel, #app .game-frame .action-panel{touch-action:none;}",
  "#game-menu:not([hidden]){z-index:20;touch-action:pan-y;overflow-y:auto;",
  "left:7px;right:7px;top:7px;bottom:7px",
  "left:7px;right:7px;top:6px;bottom:6px"
 ])assert(css.includes(fragment),"Missing menu scroll/layout guarantee: "+fragment);
 assert(!css.includes("bottom:216px")&&!css.includes("right:177px"));
});
run("NEXT cloud saves are mounted in FIELD and not BATTLE",()=>{
 const field=text("index.html"),battle=text("battle/index.html");
 assert(field.includes("init-field.js"));
 assert(field.includes('class="save-options"'));
 assert(!battle.includes("init-battle.js"));
 assert(!battle.includes('id="battle-cloud-target"'));
 assert(battle.includes("battle.js?v=11"));
});
run("FIELD NEXT jump retains same layered character, frame and altitude",()=>{
 const draws=[],commands=[],legacy={ground:0,air:0,preview:0};
 const mode={value:"layered"};
 const canvasLayers={draw(ctx,graphics,facing,x,y,w,h){
   draws.push({graphics,facing,x,y,w,h});
   return true;
 }};
 const port=createFieldVisualPort({
   canvasLayers,visualMode:()=>mode.value
 });
 const ctx={
   save(){},restore(){},translate(){},scale(){},rotate(){},
   beginPath(){},ellipse(x,y){commands.push({op:"shadow",x,y});},
   fill(){},fillRect(){commands.push({op:"placeholder"});}
 };
 class Textured {drawPlayer(){legacy.ground++;}}
 class ArcaneField {drawAirborne(){legacy.air++;}}
 class ArcanePreview {drawAirborne(){legacy.preview++;}}
 installFieldLayeredRenderers({
   TexturedRenderer:Textured,ArcaneFieldRenderer:ArcaneField,
   ArcanePreviewRenderer:ArcanePreview,visualPort:port
 });
 const runner={ctx,elapsed:.05,characterScale:.86,
   actions:{jumpOffset:()=>24},skills:{aerialSlash:null}};
 const onGround={x:120,y:160,facing:"SW",moving:false};
 Textured.prototype.drawPlayer.call(runner,onGround);
 assert.equal(draws.length,1);
 assert.equal(draws[0].y,138);
 assert.equal(draws[0].w,FIELD_AVATAR_SIZE.width);
 assert.equal(draws[0].h,FIELD_AVATAR_SIZE.height);
 const airborne={...onGround,y:onGround.y-24};
 ArcaneField.prototype.drawAirborne.call(runner,airborne);
 assert.equal(draws.length,2);
 assert.equal(draws[1].w,draws[0].w);
 assert.equal(draws[1].h,draws[0].h);
 assert.equal(draws[1].x,draws[0].x);
 assert.equal(draws[1].graphics,draws[0].graphics,
   "jump changed character graphics definition");
 assert.equal(draws[1].facing,draws[0].facing);
 assert.equal(draws[1].y,114,

   "JumpRenderer already subtracts height; do not subtract again");
 assert.equal(commands.find(x=>x.op==="shadow").y,168,
   "shadow should stay anchored to ground");
 assert.equal(legacy.ground,0);
 assert.equal(legacy.air,0);
 runner.skills.aerialSlash={height:36};
 ArcanePreview.prototype.drawAirborne.call(runner,{...onGround,y:onGround.y-36});
 assert.equal(draws.length,3);
 assert.equal(draws[2].graphics,draws[0].graphics);
 assert.equal(legacy.preview,0);
 mode.value="legacy";
 Textured.prototype.drawPlayer.call(runner,onGround);
 ArcaneField.prototype.drawAirborne.call(runner,airborne);
 assert.equal(legacy.ground,1);
 assert.equal(legacy.air,1);
});
run("FIELD real renderer inheritance: standing, walking and jump share five-layer art and effective size",()=>{
 const html=text("index.html");
 const modules=JSON.parse(html.match(/const modules=(\{[\s\S]*?\});\s*const cache=/)[1]);
 const cache=new Map();
 function load(id){
   if(cache.has(id))return cache.get(id).exports;
   assert(modules[id],"missing bundled module "+id);
   const module={exports:{}};
   cache.set(id,module);
   const require=relative=>{
     const target=path.posix.resolve(path.posix.dirname(id),relative);
     return load(target.endsWith(".ts")?target:target+".ts");
   };
   new Function("require","module","exports",modules[id])(require,module,module.exports);
   return module.exports;
 }
 const TexturedRenderer=load("/src/adapters/TexturedFieldRenderer.ts").TexturedFieldRenderer;
 const AbilityRenderer=load("/src/adapters/AbilityFieldRenderer.ts").AbilityFieldRenderer;
 const SkillMotionRenderer=load("/src/adapters/SkillMotionFieldRenderer.ts").SkillMotionFieldRenderer;
 const {ArcaneFieldRenderer,ArcanePreviewRenderer}=load("/src/adapters/ArcaneSkinRenderer.ts");
 assert.match(html,/TexturedRenderer, AbilityRenderer, SkillMotionRenderer,/);
 let sx=1,sy=1;
 const stack=[],draws=[];
 const ctx={
   save(){stack.push([sx,sy]);},restore(){[sx,sy]=stack.pop();},
   scale(x,y){sx*=x;sy*=y;},translate(){},rotate(){},
   beginPath(){},ellipse(){},fill(){}
 };
 const port=createFieldVisualPort({
   canvasLayers:{draw(c,graphics,facing,x,y,w,h){
     draws.push({graphics,facing,w:w*sx,h:h*sy});
     return true;
   }},
   visualMode:()=>"layered"
 });
 installFieldLayeredRenderers({
   TexturedRenderer,AbilityRenderer,SkillMotionRenderer,
   ArcaneFieldRenderer,ArcanePreviewRenderer,visualPort:port
 });
 for(const Renderer of [ArcaneFieldRenderer,ArcanePreviewRenderer]){
   const renderer=Object.assign(Object.create(Renderer.prototype),{
     ctx,elapsed:0,characterScale:.86,
     actions:{jumpElapsed:null,jumpOffset:()=>24},
     skills:{motion:null,charge:null,fireCharge:null,aerialSlash:null},
     loaded(){throw Error("Legacy MAGE sprite reached through real renderer");}
   });
   const first=draws.length;
   for(const [moving,jump] of [[false,false],[true,false],[false,true]]){
     const player={x:120,y:jump?136:160,facing:"SW",moving};
     renderer.localPlayer=player;
     renderer.actions.jumpElapsed=jump ? .1 : null;
     renderer.drawPlayer(player);
     assert.equal(stack.length,0);
     assert.equal(sx,1);
     assert.equal(sy,1);
   }
   const frames=draws.slice(first);
   assert.equal(frames.length,3);
   for(const frame of frames){
     assert.equal(frame.graphics,frames[0].graphics);
     assert.equal(frame.facing,"SW");
     assert(Math.abs(frame.w-FIELD_AVATAR_SIZE.width)<1e-8,"effective width "+frame.w);
     assert(Math.abs(frame.h-FIELD_AVATAR_SIZE.height)<1e-8,"effective height "+frame.h);
   }
 }
});
run("WAIT one slot restores +2 HP only if not damaged",()=>{
 assert.equal(WAIT_HEAL_HP,2);
 const simulate=(mode,{hp=70,maxHp=100,grid=true}={})=>{
   const wait={commandId:mode==="guard"?"guard":"wait",start:1,impact:1,status:"pending"};
   const actor={hp,maxHp,actions: mode==="empty"?[]:[wait]};
   const battle={phase:"running",tick:0,player:actor,
     ...(grid?{grid:{}}:{enemy:{hp:100,maxHp:100,actions:[]}}),events:[]};
   const advance=withWaitHealthRecovery(state=>{
     state.tick++;
     if(mode==="damaged")state.player.hp-=5;
     if(mode==="cancelled")wait.status="stopped";
     else wait.status="resolved";
     state.player.actions=[];
   },{sidesForBattle:()=>["player"]});
   advance(battle);
   return {actor,battle};
 };
 assert.equal(simulate("wait").actor.hp,72);
 assert.equal(simulate("wait",{hp:99}).actor.hp,100);
 assert.equal(simulate("wait",{hp:100}).actor.hp,100);
 assert.equal(simulate("damaged").actor.hp,65);
 assert.equal(simulate("cancelled").actor.hp,70);
 assert.equal(simulate("guard").actor.hp,70);
 assert.equal(simulate("empty").actor.hp,70);
 assert.equal(simulate("wait",{hp:0}).actor.hp,0);
 const result=simulate("wait");
 assert.match(result.battle.events[0],/HPを2回復/);
});
run("WAIT recovery also covers original 2-person battle",()=>{
 const player={hp:40,maxHp:100,actions:[{commandId:"wait",start:1,impact:1,status:"pending"}]};
 const enemy={hp:80,maxHp:100,actions:[{commandId:"wait",start:1,impact:1,status:"pending"}]};
 const battle={phase:"running",tick:0,player,enemy,events:[]};
 const advance=withWaitHealthRecovery(state=>{
   state.tick=1;
   player.actions[0].status="resolved";
   enemy.actions[0].status="resolved";
   enemy.hp-=12;
 },{sidesForBattle:()=>["player","enemy"]});
 advance(battle);
 assert.equal(player.hp,42);
 assert.equal(enemy.hp,68,"hit enemy must not regenerate HP");
});
run("FIELD NEXT standing and jumping keep the same scale",()=>{
 const src=text("runtime/field-visual.js");
 assert(src.includes("const w=Math.round(FIELD_AVATAR_SIZE.width*factor)"));
 assert(!src.includes('ctx.rotate(-.08'), 'Jump must not tilt the character graphic');
 assert(!src.includes("ctx.scale(this.characterScale || .86"),
   "Jump must not shrink an already normalized sprite twice");
});
run("MAGE has golden hair and an eight-direction red scarf, no red cape",()=>{
 const hair=text("content/assets/mage-layers/hair.svg");
 const outfit=text("content/assets/mage-layers/clothes.svg");
 const accessory=text("content/assets/mage-layers/accessories.svg");
 assert.match(hair,/golden-hair/);
 assert(!outfit.includes("crimson-cloak"));
 assert(!outfit.includes("cloak-regions"));
 assert.match(accessory,/Red scarf:/);
 assert.equal([...accessory.matchAll(/<g transform="translate\(/g)].length,8);
 assert.match(text("battle/next-battle.css"),/grid-unit-hellor/);
});
run("BATTLE NEXT defaults to real layered MAGE and hides provisional sprite",()=>{
 const source=text("battle/battle.js");
 assert(source.includes('characterSelect.value="mage-next";'));
 assert(source.includes('person.id !== "layered-demo"'));
 const mage=nextContent.registry.get("characters","mage-next").graphics;
 assert.equal(mage.mode,"layered");
 assert.equal(mage.width,40);
 assert.equal(mage.height,56);
 const game=createBattle(true,{risk:"balanced",waste:"some",style:"power"},
   {players:1,enemies:1});
 assert.equal(graphicsForBattle("player",game).original,mage.original);
 assert.equal(graphicsForBattle("enemy",game).mode,"layered"); // Nameless is the new default
 assert.equal(nextContent.enemyFor("nameless").characterId,"nameless");
 assert.equal(graphicsForBattle("enemy",{grid:{enemyDefinitionId:"nameless"}}).mode,"layered");
});
run("FIELD NEXT preloads five layers and never flashes old silver MAGE",()=>{
 const loaded=[],draws=[];
 const port=createFieldVisualPort({
   canvasLayers:{load(src){loaded.push(src);},draw(){return false;}},
   visualMode:()=>"layered"
 });
 assert.equal(loaded.length,5);
 assert.equal(port.draw({drawImage(){draws.push("legacy");}}, {x:20,y:100,facing:"SW"},{}),true);
 assert.deepEqual(draws,[],"No old-color fallback while textures load");
});
run("Nameless has its own five-layer, eight-direction graphics",()=>{
 const enemy=nextContent.enemyFor("nameless");
 assert.equal(enemy.displayName,"ネームレス");
 assert.equal(enemy.characterId,"nameless");
 assert.equal(enemy.ai,"standard");
 const graphics=nextContent.registry.get("characters","nameless")?.graphics;
 assert.equal(graphics.mode,"layered");
 assert.equal(graphics.width,40);
 assert.equal(graphics.height,56);
 assert.equal(Object.keys(graphics.layers).length,5);
 for(const kind of Object.keys(graphics.layers)){
   const art=text("content/assets/nameless-layers/"+kind+".svg");
   assert.match(art,/width="160" height="112"/);
   assert.equal([...art.matchAll(/<g transform="translate\(/g)].length,8);
 }
 const ui=text("battle/index.html");
 assert.match(ui,/value="nameless" selected>ネームレス/);
 assert(!ui.includes("訓練用の見張り"));
 assert.equal(nextContent.registry.get("characters","hellor").id,"hellor");
});
run("authentic 5-layer MAGE sheets cover all original pixels exactly once",()=>{
 const kinds=["skin","eyes","clothes","hair","accessories"];
 const original=fs.readFileSync(path.join(docs,"assets/mage-8dir.png"));
 const covered=new Uint8Array(160*112);
 for(const kind of kinds){
   const svg=fs.readFileSync(path.join(next,"content/assets/mage-layers",kind+".svg"),"utf8");
   assert.match(svg,/width="160" height="112"/);
   const png=svg.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
   assert(png,kind+" embedded original missing");
   assert.deepEqual(Buffer.from(png[1],"base64"),original);
   const shapes=svg.match(/<path d="([^"]+)"/);
   assert(shapes,kind+" mask missing");
   const tokens=[...shapes[1].matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)];
   assert(tokens.length>=5,kind+" has insufficient independent mask rows");
   for(const [,xs,ys,ws,back] of tokens){
     const x=Number(xs),y=Number(ys),width=Number(ws);
     assert.equal(width,Number(back));
     assert(x>=0&&x+width<=160&&y>=0&&y<112);
     for(let px=x;px<x+width;px++)covered[y*160+px]++;
   }
 }
 assert([...covered].every(count=>count===1),"Original pixel coverage must be exactly one per layer");
 const graphics=nextContent.registry.get("characters","mage-next").graphics;
 assert.equal(graphics.width,40);
 assert.equal(graphics.height,56);
 assert.equal(Object.keys(graphics.layers).length,5);
 assert(graphics.original.endsWith("/assets/mage-8dir.png"));
});
run("NEXT editor map can preserve object definition IDs",()=>{
 const map=fieldMapFor("field-starter");
 const sample=structuredClone(map);
 const item=sample.objects.find(obj=>obj.type==="tree");
 item.definitionId="tree-tall";
 const restored=validateMap(sample);
 assert.equal(restored.objects.find(obj=>obj.id===item.id).definitionId,"tree-tall");
});
run("enemy DI does not change battle's core initialization",()=>{
 const def=nextContent.enemyFor("hellor");
 const ai=createBattleAI().forEnemy(def);
 const game=createBattle(true,{risk:"balanced",waste:"some",style:"power"},
   {players:1,enemies:1,enemyType:"hellor",enemyTactics:"optimal",enemyDefinitionId:def.id,deciders:ai});
 assert.equal(game.player.hp,100);
 assert.equal(game.grid.enemyDefinitionId,"hellor");
 startBattle(game);
 assert.equal(game.phase,"running");
});
run("NEXT module imports exist",()=>{
 const files=["battle/battle.js","editor/editor.js","editor/map-schema.js",
  "content/index.js","content/characters/mage-next.js","content/maps/starter-map.js",
  "content/objects/library-pack.js","runtime/field-visual.js","content/enemies/nameless.js",
   "content/characters/nameless.js","battle/rest-recovery.js"];
 for(const relative of files){
  const abs=path.join(next,relative),code=fs.readFileSync(abs,"utf8");
  new vm.SourceTextModule(code);
  const imports=[...code.matchAll(/(?:from\s+|import\s*)["'](\.{1,2}\/[^"']+)["']/g)];
  for(const match of imports){
   const target=match[1].split("?")[0];
   assert(fs.existsSync(path.resolve(path.dirname(abs),target)),relative+" -> "+target);
  }
 }
});
console.log("NEXT regression checks completed");

run("FIELD NEXT invite URL remains selectable when clipboard fails",()=>{
 const html=text("index.html"),source=text("cloud/multiplayer-room-next.js");
 assert(html.includes('id="room-invite-url" type="url" readonly'));
 assert(html.includes("multiplayer-room-next.js?v=10"));
 assert(source.includes('url.hash="room="+code'));
 assert(source.includes('await shareInvite(address)'));
 assert(text('runtime/invite-share.js').includes('nav.clipboard.writeText(url)'));
 assert(source.includes('ui.invite.select()'));
 assert(source.includes('ui.panel.hidden=false'));
 assert(source.includes('if(!session?.connected)return;'));
});

run("FIELD dual slot selections stay independent and slash direction quantizes eight ways",()=>{
 const modules=JSON.parse(text("index.html").match(/const modules=(\{[\s\S]*?\});\s*const cache=/)[1]);
 const load=name=>{const module={exports:{}};new Function("require","module","exports",modules[name])(()=>{},module,module.exports);return module.exports;};
 const {ActionState}=load("/src/actions/ActionState.ts");
 const {ActionButtons}=load("/src/actions/ActionButtons.ts");
 const state=new ActionState();
 assert.equal(state.skillIndex("Y"),0);assert.equal(state.skillIndex("X"),1);
 state.changeSlot("Y",1);assert.equal(state.skillIndex("X"),1);
 state.changeSlot("X",1);assert.equal(state.skillIndex("Y"),1);assert.equal(state.skillIndex("X"),2);
 assert.equal(ActionButtons.prototype.direction(3,2,"N"),"N");
 assert.equal(ActionButtons.prototype.direction(-30,30,"N"),"SW");
 assert.equal(ActionButtons.prototype.direction(0,-30,"S"),"N");
 assert(text("index.html").includes('id="btn-menu"'));
});

run("FIELD remote attacks hit once, respect obstacle and reset HP",()=>{
 const updates=[],combat=new FieldCombat(hp=>updates.push(hp));
 const world={width:1600,height:1000,obstacles:[]},target={x:150,y:100,halfSize:15};
 const a={index:0,x:100,y:100,facing:"E",radius:8};
 assert.equal(combat.receive(a),false);
 combat.enable();assert(combat.receive(a));
 for(let i=0;i<20;i++)combat.tick(.05,world,target);
 assert.equal(combat.hp,90);
 combat.reset();
 assert(combat.receive(a));for(let i=0;i<20;i++)combat.tick(.05,{...world,obstacles:[{x:132,y:75,w:10,h:50}]},target);
 assert.equal(combat.hp,100);
 assert(combat.receive({index:2,x:100,y:100,facing:"E"}));
 for(let i=0;i<8;i++)combat.tick(.05,world,target);
 assert.equal(combat.hp,80);
 assert.equal(attackPacket({index:99,x:100,y:100}),null);
 assert.equal(attackPacket({index:0,x:100,y:100,dx:100,dy:0}).dx,1);
 const rules=JSON.parse(text("../firebase/database.rules.json"));
 assert(rules.rules.fieldCombat.$room.$connection.attack.$other[".validate"]===false);
});

run("ONLINE BELT uses the existing core: cooperative players own distinct slots and enemies remain AI",()=>{
 const state=lobby("coop"),members={a:{label:"A",joinedAt:1},b:{label:"B",joinedAt:2}};
 assert(prepareBattle(state,members,"a",{enemies:2,size:7}));
 assert.equal(ownedSide(state,"a"),"player");assert.equal(ownedSide(state,"b"),"ally");
 assert(applyIntent(state,"a",{kind:"reserve",command:"wait"}));
 assert(applyIntent(state,"b",{kind:"reserve",command:"wait"}));
 assert(!applyIntent(state,"outsider",{kind:"reserve",command:"quick"}));
 assert.equal(state.battle.player.actions[0].commandId,"wait");
 assert.equal(state.battle.ally.actions[0].commandId,"wait");
 assert(beginBattle(state));assert(tickBattle(state));assert.equal(state.battle.tick,1);
 assert(state.battle.enemy.actions.length>0);
});
run("ONLINE BELT PvP assigns both teams, no enemy AI, and applies real opposing damage",()=>{
 const state=lobby("versus"),members={a:{label:"A",joinedAt:1},b:{label:"B",joinedAt:2}};
 assert(prepareBattle(state,members,"a",{size:5}));
 assert.equal(ownedSide(state,"a"),"player");assert.equal(ownedSide(state,"b"),"enemy");
 assert.equal(state.battle.enemy.actions.length,0);
 assert(applyIntent(state,"a",{kind:"reserve",command:"quick",target:"enemy"}));
 assert(applyIntent(state,"b",{kind:"reserve",command:"quick",target:"player"}));
 assert(beginBattle(state));assert(tickBattle(state));
 assert(state.battle.player.hp<100&&state.battle.enemy.hp<100);
 const many=Object.fromEntries(Array.from({length:8},(_,i)=>["p"+i,{label:"P"+i,joinedAt:i}]));
 const full=lobby("versus");assert(prepareBattle(full,many,"p0",{size:7}));
 assert.equal(Object.keys(full.roster).length,8);
 assert.equal(full.battle.grid.manualEnemySides.length,4);
 assert(JSON.parse(text("../firebase/database.rules.json")).rules.beltRooms.$room.inputs);
});
run("ONLINE BELT entry and transport parse and remain accessible from field and battle",()=>{
 assert(text("index.html").includes("./next/battle/online/"));
 assert(text("battle/index.html").includes("./online/"));
 for(const file of ["belt-engine.js","belt-room.js","belt-online.js"])new vm.SourceTextModule(text("battle/online/"+file));
});

run("FIELD journal preserves coalesced three attacks and deduplicates old history",()=>{
 const attack=attackPacket({index:1,x:100,y:100,facing:"E"}),now=10000;
 const row={events:{}};
 for(let i=1;i<=3;i++){const patch=attackPatch(attack,i,now+i);row.seq=patch.seq;row.attack=patch.attack;row.events["e"+i]=patch["events/e"+i];}
 const result=recentAttackEvents(row,0,false,now+4);
 assert.deepEqual(result.events.map(e=>e.seq),[1,2,3]);assert.equal(result.lastSeq,3);
 assert.equal(recentAttackEvents(row,3,false,now+5).events.length,0);
 assert.equal(recentAttackEvents(row,0,true,now+5).events.length,0);
 assert.equal(recentAttackEvents(row,0,false,now+3000).events.length,0);
 assert.equal(motionPacket({height:999,action:1,airborne:true}).height,64);
 assert.equal(motionPacket({action:1}).action,1);
 const rules=JSON.parse(text("../firebase/database.rules.json")).rules.fieldCombat.$room.$connection;
 assert(rules.pose.height);assert(rules.events.$slot.seq);
});

run("ONLINE BELT room diagnoses exact rejected Firebase operation",()=>{
 const source=text("battle/online/belt-room.js"),ui=text("battle/online/belt-online.js");
 assert(source.includes("beltRooms/meta 読込"));
 assert(source.includes("beltRooms/meta 書込"));
 assert(source.includes("beltRooms/members"));
 assert(source.includes("beltRooms/state"));
 assert(source.includes("publish(s,true)"));
 assert(ui.includes("onLeave();status(e.message);"));
});

run("FIELD remote jump height interpolates independently of local jump",()=>{
 const modules=JSON.parse(text("index.html").match(/const modules=(\{[\s\S]*?\});\s*const cache=/)[1]);
 const module={exports:{}};new Function("require","module","exports",modules["/src/multiplayer/RemotePlayerStore.ts"])(()=>{},module,module.exports);
 const store=new module.exports.RemotePlayerStore({width:1600,height:1000});
 const id="P0123456789abcdef01234567",self="Pabcdef0123456789abcdef01";
 store.setPeers([{id,x:100,y:100,facing:"E",moving:false}],self);
 store.setMotion({[id]:{pose:motionPacket({height:28,airborne:true,action:1,facing:"E"})}});
 const peer=store.sample(.05)[0];
 assert(peer.height>0&&peer.height<28);assert(peer.remoteAirborne);assert.equal(peer.y,100);
 assert.equal(peer.remoteMotion.index,1);
 store.markAttack(id,{index:2,dx:1,dy:0});
 assert.equal(store.sample(.01)[0].remoteMotion.index,2);
 store.clear();assert.equal(store.count(),0);assert.equal(store.poses.size,0);
});
run("FIELD two receivers independently apply reciprocal damage without repeated hits",()=>{
 const a=new FieldCombat(),b=new FieldCombat();a.enable();b.enable();
 const world={width:1600,height:1000,obstacles:[]};
 const pa={x:100,y:100,halfSize:15},pb={x:150,y:100,halfSize:15};
 assert(a.receive({index:1,x:pb.x,y:pb.y,facing:"W"}));
 assert(b.receive({index:1,x:pa.x,y:pa.y,facing:"E"}));
 for(let i=0;i<12;i++){a.tick(.05,world,pa);b.tick(.05,world,pb);}
 assert.equal(a.hp,88);assert.equal(b.hp,88);
 a.setPeerHp({b:100});a.setPeerHp({b:88});
 assert.equal(a.peerHits.get("b").damage,12);
 a.setPeerHp({b:88});assert.equal(a.peerHits.get("b").damage,12);
});

run("Room code input preserves native text entry, normalizes on join only",()=>{
 const field=text("index.html"),source=text("cloud/multiplayer-room-next.js");
 assert(!/ui\.code\.addEventListener\(["']input/.test(source));
 assert(source.includes("const code=validCode(ui.code.value)"));
 const valid=source.match(/function validCode\(raw\) \{[^\n]+\}/)[0];
 const normalize=new Function(valid+";return validCode;")();
 assert.equal(normalize("aabb2233"),"AABB2233");
 assert.equal(normalize("abcd2345"),"ABCD2345");
 assert.equal(normalize("abcd-2345"),"ABCD2345");
 assert.equal(normalize("abc"),null);
 for(const [file,id] of [["index.html","room-code"],["battle/index.html","code"],["online/index.html","online-code"]]){
  const input=text(file).match(new RegExp('<input id="'+id+'"[^>]+>'))[0];
  assert(input.includes('autocapitalize="none"'));assert(input.includes('autocorrect="off"'));assert(input.includes('autocomplete="off"'));
 }
 const modules=JSON.parse(field.match(/const modules=(\{[\s\S]*?\});\s*const cache=/)[1]);
 assert(modules["/src/actions/ActionButtons.ts"].includes("if(!this.gestures.has('key-'+key))return;"));
 assert(modules["/src/input/KeyboardInput.ts"].includes("if(!this.held.has(key))return;"));
});

run("NEXT victory cue is layered and only plays once for live winners",()=>{
 const tones=[],noises=[];victoryFanfare(10,{tone:(...args)=>tones.push(args),noise:(...args)=>noises.push(args)});
 assert(tones.length>25&&noises.length>4);assert(tones.some(n=>n[5]==="sawtooth"));
 assert(Math.max(...tones.map(n=>n[0]+n[1]))>12);
 let played=0;const gate=createVictoryGate(()=>played++);
 assert(!gate.observe("late","finished",true));
 gate.observe("match","running",false);assert(gate.observe("match","finished",true));assert(!gate.observe("match","finished",true));
 gate.observe("loss","running",false);assert(!gate.observe("loss","finished",false));
 assert.equal(played,1);
 for(const file of ["battle/battle.js","online/online.js"])assert(text(file).includes("victoryFanfare"));
});
await (async()=>{
 const url="https://example.invalid/?room=ABCD2345",calls=[];
 assert.equal(await shareInvite(url,{share:async data=>calls.push(data.url),clipboard:{writeText:async()=>{throw Error("should not copy");}}}),"shared");
 assert.deepEqual(calls,[url]);
 assert.equal(await shareInvite(url,{share:async()=>{throw Object.assign(Error("cancel"),{name:"AbortError"});},clipboard:{writeText:async()=>calls.push("copy")}}),"cancelled");
 assert.deepEqual(calls,[url]);
 assert.equal(await shareInvite(url,{clipboard:{writeText:async data=>calls.push(data)}}),"copied");
 assert.equal(await shareInvite(url,{}),"manual");
 console.log("PASS native invite share, cancellation and fallback");
})();

run("Online belt uses the identical offline battle DOM, renderer and sprites",()=>{
 const page=text("battle/index.html"),entry=text("battle/online/index.html"),source=text("battle/battle.js"),adapter=text("battle/online/belt-online.js");
 assert(entry.includes('url.search=location.search'));assert(entry.includes('url.searchParams.set("online","1")'));
 for(const id of ["grid-board","grid-units","commands","player-belt","enemy-belt","player-pose","online-room","online-command-status"])assert(page.includes('id="'+id+'"'));
 assert(source.includes('gridMode = onlineMode ||'));assert(source.includes("bindBattleGrid({"));
 assert(source.includes("canControl(controlled)"));assert(source.includes("Object.assign(battle,structuredClone(next.battle))"));
 assert(source.includes("next.processed"));assert(adapter.includes("room.send(intent)"));
 assert(!adapter.includes("function render()"));assert(!adapter.includes('createElement("button")'));
 new vm.SourceTextModule(source);new vm.SourceTextModule(adapter);
});
run("Online battle snapshots include resolved commands for offline motion renderer",()=>{
 const state=lobby("versus");prepareBattle(state,{a:{label:"A"},b:{label:"B"}},"a",{size:5});
 assert(applyIntent(state,"a",{kind:"reserve",command:"quick",target:"enemy"}));
 assert(applyIntent(state,"b",{kind:"reserve",command:"quick",target:"player"}));
 beginBattle(state);tickBattle(state);
 assert.equal(state.processed.player.commandId,"quick");assert.equal(state.processed.player.status,"resolved");
 assert.equal(state.processed.enemy.commandId,"quick");
 assert(JSON.parse(JSON.stringify(state)).processed.enemy);
});

run("Belt guest rules accept exact valid commands, including empty optional command and target",()=>{
 const rule=JSON.parse(text("../firebase/database.rules.json")).rules.beltRooms.$room.inputs.$uid.$input;
 const predicate=(expr,value)=>new Function("newData","return "+expr)({isString:()=>typeof value==="string",val:()=>value});
 for(const value of ["","quick","heavy","fire","guard","dodge","jump","jumpSlash","wait","move"])assert(predicate(rule.command[".validate"],value));
 for(const value of ["","player","ally","ally2","ally3","enemy","enemy2","enemy3","enemy4"])assert(predicate(rule.target[".validate"],value));
 for(const value of ["reserve","shift","target","landing"])assert(predicate(rule.kind[".validate"],value));
 assert(!predicate(rule.command[".validate"],"hack"));assert(!predicate(rule.target[".validate"],"any"));assert(!predicate(rule.command[".validate"],42));
 assert(rule[".write"].includes("$uid == auth.uid"));assert(rule[".write"].includes(".child('members').child($uid).exists()"));
 assert(rule.$other[".validate"]===false);
 assert(text("battle/online/belt-room.js").includes('参加者："+membership'));
});
