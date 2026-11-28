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
run("registered Firebase uses owner's exact Singapore RTDB URL with realtime enabled",()=>{
 assert.equal(firebaseConfig.projectId,"gedouhukakugo");
 assert.equal(firebaseConfig.authDomain,"gedouhukakugo.firebaseapp.com");
 assert.equal(firebaseConfig.appId,"1:471281241263:web:63d1527b81bdcc6c2dd85a");
 assert.equal(firebaseConfig.databaseURL,
   "https://gedouhukakugo-default-rtdb.asia-southeast1.firebasedatabase.app/");
 assert.equal(firebaseConfig.databaseURL,firebaseConfig.verifiedRealtimeDatabaseURL);
 assert.equal(firebaseConfigured,true,"Firestore client is configured");
 assert.equal(realtimeConfigured,true,"RTDB client is configured after Rules and Anonymous Auth owner confirmation");
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
run("RTDB multiplayer connection loads only after opt-in and reuses anonymous Auth",async()=>{
 let signIns=0;
 const imports=[],auth={currentUser:null,authStateReady:async()=>{}};
 const app={options:{projectId:"gedouhukakugo"}};
 const db={kind:"realtime"};
 const mock={
  "firebase-app.js":{getApps:()=>[],initializeApp:()=>app},
  "firebase-auth.js":{getAuth:()=>auth,signInAnonymously:async()=>{signIns++;auth.currentUser={uid:"mock-uid-123456"};}},
  "firebase-database.js":{getDatabase:()=>db,ref:()=>({})}
 };
 const gateway=createFirebaseGateway({
  config:firebaseConfig,
  importer:async url=>{const key=url.split("/").pop();imports.push(key);return mock[key];},
  storage:{getItem:()=>null,setItem:()=>{}}
 });
 assert.equal(gateway.realtimeConfigured,true);
 assert.equal(imports.length,0,"No SDK or auth loads before player clicks Online");
 const first=await gateway.connect("realtime");
 const second=await gateway.connect("realtime");
 assert.equal(first.db,db);
 assert.equal(first.api,mock["firebase-database.js"]);
 assert.equal(first.uid,"mock-uid-123456");
 assert.equal(second.uid,first.uid);
 assert.equal(signIns,1,"One anonymous identity per browser session");
 assert(!imports.includes("firebase-firestore.js"),"Multiplayer must not require Firestore");
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
run("online cooperation allows more than four players with distinct positions",()=>{
 const members=Object.fromEntries(Array.from({length:24},(_,i)=>[
   "player-"+String(i).padStart(2,"0"),{label:"仲間"+i}
 ]));
 const state=updateArena(initialArena("coop"),members,{});
 assert.equal(Object.keys(state.players).length,24,"All 24 participants must join the simulation");
 const positions=Object.values(state.players).map(p=>p.x+","+p.y);
 assert.equal(new Set(positions).size,24,"All new arrivals must get a distinct initial tile");
 assert(Object.values(state.players).every(p=>p.team===0));
 assert(JSON.stringify(state).length<18000,"24 players must fit current RTDB rules");
});
run("online versus balances larger teams and keeps team assignments stable",()=>{
 const members=Object.fromEntries(Array.from({length:17},(_,i)=>[
   "p-"+String(i).padStart(2,"0"),{label:"相手"+i}
 ]));
 let state=updateArena(initialArena("versus"),members,{});
 assert.equal(Object.keys(state.players).length,17);
 const team0=Object.values(state.players).filter(p=>p.team===0).length;
 const team1=Object.values(state.players).filter(p=>p.team===1).length;
 assert(Math.abs(team0-team1)<=1,"Teams must remain balanced when many players join");
 const existing=Object.fromEntries(Object.entries(state.players)
   .map(([uid,p])=>[uid,{team:p.team,x:p.x,y:p.y}]));
 members["a-late"]={label:"途中参加"};
 state=updateArena(state,members,{});
 assert.equal(Object.keys(state.players).length,18);
 for(const [uid,before] of Object.entries(existing)){
  assert.equal(state.players[uid].team,before.team,"New join must not reshuffle teams");
  assert.equal(state.players[uid].x,before.x,"New join must not teleport player");
  assert.equal(state.players[uid].y,before.y,"New join must not teleport player");
 }
 assert.equal(new Set(Object.values(state.players).map(p=>p.x+","+p.y)).size,18);
 delete members["p-03"];
 state=updateArena(state,members,{});
 assert.equal(Object.keys(state.players).length,17,"Players who leave must be removed");
 assert.equal(state.players["p-03"],undefined);
});
run("online UI no longer advertises a four-person room cap",()=>{
 const html=fs.readFileSync(path.join(root,"online/index.html"),"utf8");
 const js=fs.readFileSync(path.join(root,"online/online.js"),"utf8");
 const engine=fs.readFileSync(path.join(root,"online/arena-engine.js"),"utf8");
 assert(!js.includes('labels.length+"/4'));
 assert(!engine.includes("slice(0,4)"));
 assert(html.includes("固定4人制限はありません"));
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
run("Belt transport accepts commands from two independent authenticated clients in coop and versus",async()=>{
 const {createBeltRoom}=await import("../battle/online/belt-room.js");
 const clone=v=>v===undefined?undefined:structuredClone(v);
 const data={},listeners=new Map();let serial=0;
 function read(path){return path.split("/").filter(Boolean).reduce((v,k)=>v?.[k],data);}
 function snap(path){const v=clone(read(path));return {val:()=>v??null,exists:()=>v!=null};}
 function notify(path){for(const [p,callbacks] of listeners)if(path===p||path.startsWith(p+"/")||p.startsWith(path+"/"))for(const fn of callbacks)queueMicrotask(()=>fn(snap(p)));}
 function write(path,value){const parts=path.split("/"),key=parts.pop();let node=data;for(const p of parts)node=node[p]??={};if(value===null)delete node[key];else node[key]=clone(value);notify(path);}
 const api={ref:(_,p)=>({path:p}),get:async r=>snap(r.path),set:async(r,v)=>write(r.path,v),remove:async r=>write(r.path,null),serverTimestamp:()=>Date.now(),onDisconnect:()=>({remove:async()=>{},cancel:async()=>{}}),onValue(r,fn){let a=listeners.get(r.path);if(!a){a=new Set();listeners.set(r.path,a);}a.add(fn);queueMicrotask(()=>fn(snap(r.path)));return ()=>a.delete(fn);},push:r=>{const key="p"+String(++serial).padStart(5,"0");return {path:r.path+"/"+key,key};}};
 const settle=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
 for(const mode of ["coop","versus"]){
  let guestState,hostState;
  const host=createBeltRoom({connection:{api,db:{},uid:"host"},onState:s=>{hostState=clone(s);}});
  const guest=createBeltRoom({connection:{api,db:{},uid:"guest"},onState:s=>{guestState=s;}});
  try{
   const code=await host.create(mode,"HOST");await guest.join(code,"GUEST");await settle();
   await host.prepare({size:5,enemies:2});await settle();
   const side=mode==="coop"?"ally":"enemy";assert.equal(guestState.roster[side].uid,"guest");
   const cmd=await guest.send({kind:"reserve",command:"wait"});await settle();
   assert.equal(guestState.acks.guest.id,cmd.id);
   assert.equal(guestState.acks.guest.accepted,true);
   assert.equal(hostState.battle[side].actions[0].commandId,"wait");
   assert.equal(guestState.battle[side].actions[0].commandId,"wait");
   assert.equal(guestState.battle[side].actions.length,1);
   await host.send({kind:"reserve",command:"wait"});await settle();
   assert.equal(guestState.battle.player.actions[0].commandId,"wait");
   await host.start();await settle();assert.equal(guestState.phase,"running");
  }finally{await guest.leave();await host.leave();}
 }
});
await Promise.all(awaitable);
console.log("NEXT CLOUD ONLINE checks completed");
