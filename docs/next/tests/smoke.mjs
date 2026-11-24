import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import {fileURLToPath} from "node:url";
import { nextContent, graphicsForBattle, fieldMapFor, objectDefinitionFor, createNextContent } from "../content/index.js";
import { createLayeredCanvas } from "../../shared/modkit/layered-canvas.js";
import { createDefinitionRegistry } from "../../shared/modkit/definition-registry.js";
import { validateMap, STORAGE_KEY } from "../editor/map-schema.js";
import { createBattle, startBattle, advanceBattle } from "../../battle/rules.js";
import { createBattleAI } from "../../battle/content/ai-services.js";

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
 assert(draw.every(row=>row[2]===90&&row[3]===0&&row[4]===30&&row[5]===42));
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
  "content/objects/library-pack.js","runtime/field-visual.js"];
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
