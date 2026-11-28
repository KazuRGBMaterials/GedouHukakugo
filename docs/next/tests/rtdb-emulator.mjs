// Real RTDB rules emulator, not a permissive mock transport.
import fs from "node:fs";
import assert from "node:assert/strict";
import {initializeTestEnvironment,assertSucceeds,assertFails} from "@firebase/rules-unit-testing";
import {ref,set,get,push,update,serverTimestamp,remove} from "firebase/database";
const env=await initializeTestEnvironment({projectId:"demo-gedo",database:{rules:fs.readFileSync(process.argv[2],"utf8")}});
try{
 const host=env.authenticatedContext("host").database(),guest=env.authenticatedContext("guest").database(),outsider=env.authenticatedContext("outsider").database();
 const belt="beltRooms/ABCDEFGHJKLM",now=()=>serverTimestamp();
 await assertSucceeds(get(ref(host,belt+"/meta")));
 await assertSucceeds(set(ref(host,belt+"/meta"),{owner:"host",mode:"versus",createdAt:now()}));
 for(const [db,uid] of [[host,"host"],[guest,"guest"]])await assertSucceeds(set(ref(db,belt+"/members/"+uid),{label:uid,joinedAt:now()}));
 await assertSucceeds(set(ref(host,belt+"/state"),{revision:0,payload:"{}",updatedAt:now()}));
 await assertSucceeds(get(ref(guest,belt+"/state")));
 for(const cmd of [
  {kind:"reserve",command:"quick",x:-1,y:-1,target:"player"},
  {kind:"reserve",command:"wait",x:-1,y:-1,target:""},
  {kind:"reserve",command:"move",x:2,y:2,target:""},
  {kind:"shift",command:"",x:-1,y:-1,target:""},
  {kind:"target",command:"",x:-1,y:-1,target:"player"},
  {kind:"landing",command:"",x:1,y:2,target:""}
 ]){
  const node=push(ref(guest,belt+"/inputs/guest"));
  await assertSucceeds(set(node,{...cmd,at:now()}));
  await assertSucceeds(get(ref(host,belt+"/inputs")));
  await assertSucceeds(remove(ref(host,belt+"/inputs/guest/"+node.key)));
 }
 const intent={kind:"reserve",command:"quick",x:-1,y:-1,target:"player",at:now()};
 await assertFails(set(push(ref(outsider,belt+"/inputs/outsider")),intent));
 await assertFails(set(push(ref(guest,belt+"/inputs/host")),intent));
 await assertFails(set(push(ref(guest,belt+"/inputs/guest")),{...intent,command:"invalid"}));
 await assertFails(set(ref(guest,belt+"/state"),{revision:1,payload:"{}",updatedAt:now()}));
 const code="ABCD2345",ids=["P"+"1".repeat(24),"P"+"2".repeat(24)];
 const pose={height:0,airborne:false,action:-1,charge:false,angle:0,chargeSeconds:0,dash:false,facing:"E"};
 for(const [i,db,uid] of [[0,host,"host"],[1,guest,"guest"]]){
  const path="rooms/"+code+"/players/"+ids[i];
  await assertSucceeds(set(ref(db,path),{owner:uid,label:uid,color:0,x:100+i*50,y:100,facing:"E",moving:false,seq:1,updatedAt:now()}));
  const cp="fieldCombat/"+code+"/"+ids[i];
  await assertSucceeds(set(ref(db,cp),{owner:uid,hp:100,seq:0,pose}));
  const attack={index:1,x:100+i*50,y:100,dx:i?-1:1,dy:0,radius:15,combo:1,kind:"cast",at:now()};
  await assertSucceeds(update(ref(db,cp),{seq:1,attack,"events/e1":{...attack,seq:1}}));
  await assertSucceeds(update(ref(db,cp),{hp:88,pose:{...pose,height:28,airborne:true,action:1}}));
 }
 const hit={index:0,source:ids[0],seq:1,id:1,x:150,y:100,damage:10,at:now()};
 await assertSucceeds(update(ref(guest,"fieldCombat/"+code+"/"+ids[1]),{"hits/e1":hit}));
 await assertFails(update(ref(host,"fieldCombat/"+code+"/"+ids[1]),{"hits/e2":{...hit,id:2}}));
 await assertFails(update(ref(guest,"fieldCombat/"+code+"/"+ids[1]),{"hits/e99":{...hit,id:99}}));
 await assertSucceeds(get(ref(guest,"fieldCombat/"+code)));
 await assertSucceeds(get(ref(host,"fieldCombat/"+code)));
 await assertFails(update(ref(guest,"fieldCombat/"+code+"/"+ids[0]),{hp:0}));
 await assertFails(update(ref(host,"fieldCombat/"+code+"/"+ids[1]),{hp:0}));
 const coop="fieldCoop/"+code,coPos="coopPlayers/"+code+"/players/",coCombat="coopCombat/"+code+"/";
 await assertSucceeds(set(ref(host,coop+"/meta"),{owner:"host",connection:ids[0],createdAt:now()}));
 await assertFails(set(ref(guest,coop+"/meta"),{owner:"guest",connection:ids[1],createdAt:now()}));
 for(const [i,db,uid] of [[0,host,"host"],[1,guest,"guest"]]){
  await assertSucceeds(set(ref(db,coPos+ids[i]),{owner:uid,label:uid,color:0,x:100+i*50,y:100,facing:"E",moving:false,seq:1,updatedAt:now()}));
  await assertSucceeds(set(ref(db,coCombat+ids[i]),{owner:uid,hp:100,seq:0,pose}));
  const attack={index:1,x:100+i*50,y:100,dx:i?-1:1,dy:0,radius:15,combo:1,kind:"cast",at:now()};
  await assertSucceeds(update(ref(db,coCombat+ids[i]),{seq:1,attack,"events/e1":{...attack,seq:1}}));
 }
 const snap={revision:1,payload:JSON.stringify({enemies:[{id:"hellor",hp:370}],events:[]}),writer:ids[0],updatedAt:now()};
 await assertSucceeds(set(ref(host,coop+"/state"),snap));await assertSucceeds(get(ref(guest,coop+"/state")));
 await assertFails(set(ref(guest,coop+"/state"),{...snap,revision:2}));
 await assertFails(update(ref(guest,coCombat+ids[0]),{hp:0}));
 const oldMeta=(await get(ref(guest,coop+"/meta"))).val();
 const takeover={...oldMeta,owner:"guest",connection:ids[1]};
 await assertFails(set(ref(guest,coop+"/meta"),takeover));
 await assertFails(set(ref(outsider,coop+"/meta"),{...oldMeta,owner:"outsider",connection:"P"+"3".repeat(24)}));
 await assertSucceeds(remove(ref(host,coPos+ids[0])));
 await assertSucceeds(set(ref(guest,coop+"/meta"),takeover));
 const checkpoint=(await get(ref(guest,coop+"/state"))).val();assert(checkpoint.payload===snap.payload);
 await assertFails(set(ref(host,coop+"/state"),{...snap,revision:2}));
 await assertFails(set(ref(guest,coop+"/state"),{...snap,revision:2}));
 await assertFails(set(ref(guest,coop+"/state"),{...snap,writer:ids[1],revision:1}));
 await assertSucceeds(set(ref(guest,coop+"/state"),{...snap,writer:ids[1],revision:2,payload:JSON.stringify({enemies:[{id:"hellor",hp:340}],events:[]})}));
 console.log("PASS real RTDB rules: both guests and hosts, command variants, field attacks, HP and isolation");
}finally{await env.cleanup();}
