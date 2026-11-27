import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {installationId,makeRoomCode,normalizeRoomCode,INSTALLATION_KEY} from "../cloud/identity.js";
import {createFirebaseGateway,firebaseConfigured,realtimeConfigured} from "../cloud/firebase-service.js";
import {firebaseConfig} from "../../assets/firebase-config.js";
import {createCloudSaveStore,SaveConflictError,SLOT_NAMES} from "../cloud/save-store.js";
import {initialArena,updateArena,crystalPositions,ARENA_COLUMNS,ARENA_ROWS} from "../online/arena-engine.js";

const dir=path.dirname(fileURLToPath(import.meta.url));
const docs=path.resolve(dir,"../..");
const root=path.resolve(dir,"..");
function run(name,fn){awaitable.push(Promise.resolve().then(fn).then(()=>console.log("PASS",name)));}
const awaitable=[];

run("no Firebase traffic, identity generation or auth before opt-in",async()=>{
 assert.equal(firebaseConfigured,true,"Registered Web app may support Firestore after setup");
 let imports=0,created=0;
 const client=createFirebaseGateway({config:null,importer:()=>{imports++;},
  storage:{getItem(){created++;},setItem(){created++;}}});
 assert.equal(client.configured,false);
 await assert.rejects(()=>client.connect(),/Webアプリの設定がありません/);
 assert.equal(imports,0);
 assert.equal(created,0);
});
run("registered Firebase supports Firestore but keeps RTDB disabled until real URL",()=>{
 assert.equal(firebaseConfig.projectId,"gedouhukakugo");
 assert.equal(firebaseConfig.authDomain,"gedouhukakugo.firebaseapp.com");
 assert.equal(firebaseConfig.appId,"1:471281241263:web:63d1527b81bdcc6c2dd85a");
 assert.equal(firebaseConfig.databaseURL,null,"Never infer the Realtime Database region");
 assert.equal(firebaseConfig.verifiedRealtimeDatabaseURL,
   "https://gedouhukakugo-default-rtdb.asia-southeast1.firebasedatabase.app/");
 assert.equal(firebaseConfigured,true,"Web app can connect to Firestore after enabling it in Console");
 assert.equal(realtimeConfigured,false,"RTDB must remain disabled until its URL is known");
 assert.equal(Object.isFrozen(firebaseConfig),true);
});
run("Firestore connection uses Auth once and never imports RTDB",async()=>{
 const imports=[],auth={currentUser:null,authStateReady:async()=>{}};
 const app={options:{projectId:"gedouhukakugo"}};
 const mock={
   "firebase-app.js":{getApps:()=>[],initializeApp:()=>app},
   "firebase-auth.js":{getAuth:()=>auth,signInAnonymously:async()=>{auth.currentUser={uid:"uid-test-123456"};}},
   "firebase-firestore.js":{getFirestore:()=>({kind:"firestore"}),doc:()=>({})}
 };
 const gateway=createFirebaseGateway({
  config:{apiKey:"public-web-key",projectId:"gedouhukakugo",appId:"123",databaseURL:null},
  importer:async url=>{const key=url.split("/").pop();imports.push(key);return mock[key];},
  storage:{getItem:()=>null,setItem:()=>{}}
 });
 assert.equal(gateway.configured,true);
 assert.equal(gateway.realtimeConfigured,false);
 await assert.rejects(()=>gateway.connect("realtime"),/URLが未設定/);
 assert.equal(imports.length,0,"Do not authorize or import SDK without RTDB URL");
 const connection=await gateway.connect();
 assert.equal(connection.uid,"uid-test-123456");
 assert.equal(connection.firestore.kind,"firestore");
 assert.equal(connection.api,undefined,"No RTDB SDK in save connection");
 assert(!imports.includes("firebase-database.js"));
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
run("Firestore owner-scoped save transactions detect conflicts and do not overwrite",async()=>{
 const values=new Map();
 const target=(...segments)=>segments.join("/");
 const snapshot=key=>({exists:()=>values.has(key),data:()=>values.get(key)});
 const api={
  doc(_db,...segments){return target(...segments);},
  serverTimestamp(){return {serverTimestamp:true};},
  async getDocFromServer(name){return snapshot(name);},
  async runTransaction(_db,handler){
   const staged=[];
   const transaction={
     get:async name=>snapshot(name),
     set:(name,value)=>staged.push(["set",name,value]),
     delete:name=>staged.push(["delete",name])
   };
   const result=await handler(transaction);
   for(const [operation,name,value] of staged)
     if(operation==="delete")values.delete(name);else values.set(name,value);
   return result;
  }
 };
 const store=createCloudSaveStore({
  firestore:{},firestoreApi:api,uid:"user-123456",deviceId:"ab".repeat(16)
 });
 assert.equal(await store.load("field-main"),null);
 const record=await store.save("field-main",{x:123,y:45},null);
 assert.equal(record.schemaVersion,1);
 assert.equal(record.revision,1);
 assert.equal(record.deviceId,"ab".repeat(16));
 assert.equal(record.data.x,123);
 const key="cloudSaves/user-123456/slots/field-main";
 assert(values.has(key));
 await assert.rejects(()=>store.save("field-main",{x:999},null),SaveConflictError);
 assert.equal((await store.load("field-main")).data.x,123);
 const second=await store.save("field-main",{x:124},1);
 assert.equal(second.revision,2);
 await assert.rejects(()=>store.remove("field-main",1),SaveConflictError);
 await store.remove("field-main",2);
 assert.equal(await store.load("field-main"),null);
 await assert.rejects(()=>store.save("unknown-slot",{x:0},null),/Unsupported save slot/);
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
run("Realtime Database rules remain unchanged for multiplayer, Firestore rules restrict saves",()=>{
 const rules=JSON.parse(fs.readFileSync(path.join(docs,"firebase/database.rules.json"),"utf8")).rules;
 assert.equal(rules[".read"],false);
 assert.equal(rules[".write"],false);
 assert(rules.rooms["$room"].players);
 const arena=rules.arenaRooms["$room"];
 assert.match(arena.meta[".write"],/auth.uid/);
 assert(arena.state[".write"].includes("meta/owner"));
 assert(arena.inputs["$uid"][".write"].includes("auth.uid == $uid"));
 assert(arena.members["$uid"][".write"].includes("auth.uid == $uid"));
 // RuleDataSnapshot has hasChildren() but NOT DataSnapshot.numChildren().
 // Prevent errors at publish time and enforce allowed field schemas instead.
 const allRuleExpressions=[];
 const inspect=value=>{
  if(typeof value==="string")allRuleExpressions.push(value);
  else if(value&&typeof value==="object")Object.values(value).forEach(inspect);
 };
 inspect(rules);
 assert(!allRuleExpressions.some(rule=>rule.includes(".numChildren(")),
   "RTDB Security Rules must not call client-only DataSnapshot.numChildren()");
 const assertExactFields=(node,fields)=>{
  for(const field of fields)
   assert(node[field] && node[field][".validate"]!==false,
     "Known field must not match catch-all deny rule: "+field);
  assert.equal((node["$other"]||node["$extra"])?.[".validate"],false,
   "Unknown data fields must still be rejected");
 };
 assertExactFields(arena.meta,["owner","mode","createdAt"]);
 assertExactFields(arena.members["$uid"],["label","joinedAt"]);
 assertExactFields(arena.inputs["$uid"],["seq","dx","dy","attack","updatedAt"]);
 assertExactFields(arena.state,["tick","payload","updatedAt"]);
 assertExactFields(rules.cloudSaves["$uid"]["$slot"],
   ["schemaVersion","slotId","revision","deviceId","updatedAt","payload"]);
 assertExactFields(rules.rooms["$room"].players["$connection"],
   ["owner","label","color","x","y","facing","moving","seq","updatedAt"]);
 // With no child-count primitive in RTDB Rules, a strict room-size limit
 // cannot be safely expressed with this UID-keyed structure. Arena engine
 // still simulates at most four; server-side slots need future redesign.
 const firestoreRules=fs.readFileSync(path.join(docs,"firebase/firestore.rules"),"utf8");
 assert.match(firestoreRules,/service cloud.firestore/);
 assert.match(firestoreRules,/request.auth.uid == userId/);
 assert.match(firestoreRules,/allow list: if false/);
 assert.match(firestoreRules,/allow create:/);
 assert.match(firestoreRules,/allow update:/);
 assert(firestoreRules.includes("request.resource.data.revision == resource.data.revision + 1"));
 assert(firestoreRules.includes("data.payload.size() <= 200000"));
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
