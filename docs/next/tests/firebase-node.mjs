import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {installationId,makeRoomCode,normalizeRoomCode,INSTALLATION_KEY} from "../cloud/identity.js";
import {createFirebaseGateway,firebaseConfigured} from "../cloud/firebase-service.js";
import {createCloudSaveStore,SaveConflictError,SLOT_NAMES} from "../cloud/save-store.js";
import {initialArena,updateArena,crystalPositions,ARENA_COLUMNS,ARENA_ROWS} from "../online/arena-engine.js";

const dir=path.dirname(fileURLToPath(import.meta.url));
const docs=path.resolve(dir,"../..");
const root=path.resolve(dir,"..");
function run(name,fn){awaitable.push(Promise.resolve().then(fn).then(()=>console.log("PASS",name)));}
const awaitable=[];

run("no Firebase traffic, identity generation or auth before opt-in",async()=>{
 assert.equal(firebaseConfigured,false,"Unconfigured Firebase must stay disabled");
 let imports=0,created=0;
 const client=createFirebaseGateway({config:null,importer:()=>{imports++;},
  storage:{getItem(){created++;},setItem(){created++;}}});
 assert.equal(client.configured,false);
 await assert.rejects(()=>client.connect(),/Firebase未設定/);
 assert.equal(imports,0);
 assert.equal(created,0);
});
run("opaque device ID stable across reloads, without fingerprint",()=>{
 const map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
 const bytes=Array.from({length:16},(_,i)=>i);
 const first=installationId(storage,()=>bytes);
 assert.equal(first,"000102030405060708090a0b0c0d0e0f");
 assert.equal(map.get(INSTALLATION_KEY),first);
 assert.equal(installationId(storage,()=>{throw Error("Random should not be called")}),first);
 const code=makeRoomCode(()=>Array(12).fill(0));
 assert.equal(code,"AAAAAAAAAAAA");
 assert.equal(normalizeRoomCode("aaaa aaaa aaaa"),code);
 assert.equal(normalizeRoomCode("INVALID"),null);
});
run("per-UID cloud save revision and conflict",async()=>{
 const values=new Map();
 const api={
  ref(_db,name){return name},
  serverTimestamp(){return 1700000000000},
  async get(name){return {val:()=>values.get(name)||null}},
  async runTransaction(name,cb){
   const next=cb(values.get(name)||null);
   if(next===undefined)return {committed:false,snapshot:{val:()=>values.get(name)||null}};
   if(next===null)values.delete(name);else values.set(name,next);
   return {committed:true,snapshot:{val:()=>next}};
  }
 };
 const store=createCloudSaveStore({db:{},api,uid:"user-123456",deviceId:"ab".repeat(16)});
 assert.equal(await store.load("field-main"),null);
 const record=await store.save("field-main",{x:123,y:45},null);
 assert.equal(record.schemaVersion,1);
 assert.equal(record.revision,1);
 assert.equal(record.deviceId,"ab".repeat(16));
 assert.equal(record.data.x,123);
 await assert.rejects(()=>store.save("field-main",{x:999},null),SaveConflictError);
 const second=await store.save("field-main",{x:124},1);
 assert.equal(second.revision,2);
 await assert.rejects(()=>store.remove("field-main",1),SaveConflictError);
 await store.remove("field-main",2);
 assert.equal(await store.load("field-main"),null);
 assert.deepEqual(SLOT_NAMES,["field-main","field-preview","editor-map","battle-setup"]);
});
run("host-only deterministic arena: cooperation collects shared objectives",()=>{
 let state=initialArena("coop");
 const members={alpha:{label:"MAGE"},beta:{label:"仲間"}};
 state=updateArena(state,members,{});
 assert.equal(Object.keys(state.players).length,2);
 assert.equal(state.players.alpha.team,0);
 assert.equal(state.players.beta.team,0);
 let seq=1;
 for(const point of crystalPositions()){
  state.players.alpha.x=point[0];state.players.alpha.y=point[1];
  state=updateArena(state,members,{alpha:{dx:0,dy:0,attack:false,seq:seq++}});
 }
 assert.equal(state.phase,"finished");
 assert.equal(state.winner,"coop");
 assert.equal(state.collected.length,6);
 const after=updateArena(state,members,{});
 assert.equal(after.collected.length,6);
});
run("versus attack only targets opponent, validated adjacency & cooldown",()=>{
 let world=initialArena("versus");
 const members={alpha:{label:"MAGE"},beta:{label:"敵"}};
 world=updateArena(world,members,{});
 assert.equal(world.players.alpha.team,0);
 assert.equal(world.players.beta.team,1);
 world.players.alpha.x=5;world.players.alpha.y=3;
 world.players.beta.x=6;world.players.beta.y=3;
 world=updateArena(world,members,{alpha:{dx:0,dy:0,attack:true,seq:1}});
 assert.equal(world.players.beta.hp,80);
 world=updateArena(world,members,{alpha:{dx:0,dy:0,attack:true,seq:2}});
 assert.equal(world.players.beta.hp,80,"Cooldown must stop next-tick spam");
 for(let i=0;i<4;i++)world=updateArena(world,members,{});
 world=updateArena(world,members,{alpha:{dx:0,dy:0,attack:true,seq:3}});
 assert.equal(world.players.beta.hp,60);
 const x=world.players.alpha.x,y=world.players.alpha.y;
 world=updateArena(world,members,{alpha:{dx:100,dy:0,attack:false,seq:4}});
 assert(Math.abs(world.players.alpha.x-x)<=1);
 assert.equal(world.players.alpha.y,y);
 assert.equal(ARENA_COLUMNS,12);
 assert.equal(ARENA_ROWS,8);
});
run("database rules keep original field rooms and restrict owner/host writes",()=>{
 const rules=JSON.parse(fs.readFileSync(path.join(docs,"firebase/database.rules.json"),"utf8")).rules;
 assert.equal(rules[".read"],false);
 assert.equal(rules[".write"],false);
 assert(rules.rooms["$room"].players);
 const saves=rules.cloudSaves["$uid"];
 assert.match(saves[".read"],/auth.uid == \$uid/);
 assert.match(saves["$slot"][".write"],/auth.uid == \$uid/);
 assert.match(saves["$slot"][".validate"],/revision/);
 const room=rules.arenaRooms["$room"];
 assert.match(room.meta[".write"],/auth.uid/);
 assert.match(room.state[".write"],/meta\/owner/);
 assert.match(room.inputs["$uid"][".write"],/auth.uid == \$uid/);
 assert.match(room.members["$uid"][".write"],/auth.uid == \$uid/);
});
run("existing game engines and legacy entrypoints remain untouched",()=>{
 for(const p of ["index.html","battle/index.html","editor/index.html"])
  assert(fs.existsSync(path.join(docs,p)));
 for(const p of ["index.html","battle/index.html","editor/index.html"])
  assert(fs.existsSync(path.join(root,p)));
 const field=fs.readFileSync(path.join(root,"index.html"),"utf8");
 assert(field.includes("__gedoNextCloudPort"));
 assert(field.includes("init-field.js"));
 assert(field.includes("multiplayer-room-next.js"));
 const editor=fs.readFileSync(path.join(root,"editor/editor.js"),"utf8");
 assert(editor.includes("__gedoNextEditorCloudPort"));
 const battle=fs.readFileSync(path.join(root,"battle/battle.js"),"utf8");
 assert(battle.includes("__gedoNextBattleCloudPort"));
 const page=fs.readFileSync(path.join(root,"online/index.html"),"utf8");
 assert(page.includes("協力ルーム作成"));
 assert(page.includes("対戦ルーム作成"));
});
await Promise.all(awaitable);
console.log("NEXT CLOUD ONLINE checks completed");
