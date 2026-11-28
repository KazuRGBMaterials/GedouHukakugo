import {shareInvite} from "../runtime/invite-share.js?v=1";
import { attackPacket } from "../runtime/field-combat.js?v=10";
import {motionPacket,attackPatch,recentAttackEvents} from "../runtime/field-sync.js?v=2";
import { createNpcJournal,readNpcSnapshot,chooseCoopLeader,bootstrapCoop,readHitEvents } from "../runtime/field-coop-sync.js?v=6";
import { firebaseConfig } from "../../assets/firebase-config.js?v=4";

/**
 * Firebase Realtime Database transport — separate from game engine and sprite renderer.
 * Same public Pages URL; a room code selects one shared field. One anonymous auth identity
 * per browser profile and one connection ID per open page. No IP-based player merging.
 */
const ui = {
  toggle:document.getElementById("room-toggle"),
  panel:document.getElementById("room-panel"),
  dismiss:document.getElementById("room-close"),
  name:document.getElementById("room-name"),
  code:document.getElementById("room-code"),
  color:document.getElementById("room-color"),
  mode:document.getElementById("room-mode"),
  create:document.getElementById("room-create"),
  createVersus:document.getElementById("room-create-versus"),
  join:document.getElementById("room-join"),
  leave:document.getElementById("room-leave"),
  share:document.getElementById("room-share"),
  invite:document.getElementById("room-invite-url"),
  inviteLabel:document.getElementById("room-invite-label"),
  status:document.getElementById("room-status"),
  summary:document.getElementById("room-summary")
};
const port=window.__gedoRoomPort;
const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const storage={
  get(key,fallback){try{return localStorage.getItem(key)||fallback;}catch{return fallback;}},
  set(key,value){try{localStorage.setItem(key,value);}catch{}}
};
function randomCode(size=8){
  const bytes=new Uint8Array(size);crypto.getRandomValues(bytes);
  return Array.from(bytes,v=>alphabet[v%alphabet.length]).join("");
}
function validCode(raw) {const value=String(raw||"").trim().toUpperCase().replace(/[ -]/g,"");return /^[A-HJ-NP-Z2-9]{8}$/.test(value)?value:null;}
function say(msg,state="idle"){
  ui.status.textContent=msg;
  ui.status.dataset.state=state;
  if(!session){ui.summary.textContent=state==="error"?"通信エラー":"SOLO / 未接続";return;}
  if(state==="online")ui.summary.textContent=(session.mode==="coop"?"COOP ":"ROOM ")+session.code+" · "+session.count+"人";
  else ui.summary.textContent="ROOM "+session.code+" · 接続確認中";
}
function selfState(){
  const p=port.getSelf();
  const bounds=port.getWorldBounds?.() || {width:1280,height:800};
  return {
    owner:auth.currentUser.uid,
    label:(ui.name.value.trim()||"プレイヤー").slice(0,16),
    color:Number(ui.color.value)||0,
    x:Math.round(Math.min(bounds.width,Math.max(0,p.x))*10)/10,
    y:Math.round(Math.min(bounds.height,Math.max(0,p.y))*10)/10,
    facing:["N","NE","E","SE","S","SW","W","NW"].includes(p.facing)?p.facing:"S",
    moving:!!p.moving,
    seq:++sequence,
    updatedAt:api.serverTimestamp()
  };
}
let api=null,app=null,auth=null,db=null;
let session=null,sequence=0,token=0;
let unsubRoom=null,unsubConnection=null,sendTimer=null,lastSent=null,lastWriteAt=0;
let unsubCombat=null,combatSeq=0,serverOffset=0,unsubClock=null;
let combatRetry=null;
function stopCombatRetry(){if(combatRetry!==null){clearTimeout(combatRetry);combatRetry=null;}}
const npcStatus=document.getElementById("room-npc-status");
const npcSay=message=>{if(npcStatus)npcStatus.textContent=message;};
const combatStatus=document.getElementById("room-combat-status");
const combatSay=message=>{if(combatStatus)combatStatus.textContent=message;};
const configured=!!(firebaseConfig&&firebaseConfig.apiKey&&firebaseConfig.projectId&&firebaseConfig.appId&&firebaseConfig.databaseURL);
const savedName=storage.get("gedo-room-name","");
ui.name.value=savedName||("MAGE-"+String(Math.floor(Math.random()*90)+10));
ui.color.value=storage.get("gedo-room-color","0");
const fragment=location.hash.match(/(?:^#|&)\b(room|coop)=([A-HJ-NP-Z2-9]{8})(?:&|$)/i);
if(fragment){ui.code.value=fragment[2].toUpperCase();ui.mode.value=fragment[1].toLowerCase()==="coop"?"coop":"versus";ui.panel.hidden=false;}
ui.panel.addEventListener("touchmove",event=>event.stopPropagation(),{passive:true});
window.addEventListener("keydown",event=>{if(event.key==="Escape"&&!ui.panel.hidden)ui.panel.hidden=true;});
ui.toggle.addEventListener("click",()=>{ui.panel.hidden=!ui.panel.hidden;});
ui.dismiss.addEventListener("click",()=>{ui.panel.hidden=true;});
ui.name.addEventListener("change",()=>storage.set("gedo-room-name",ui.name.value.trim().slice(0,16)));
ui.color.addEventListener("change",()=>storage.set("gedo-room-color",ui.color.value));
// Preserve native input and IME composition. Normalize only when Join is pressed (validCode).
function inviteAddress(code){
  const url=new URL(location.href);
  url.hash=(session?.mode==="coop"?"coop=":"room=")+code;
  return url.href;
}
function showInvite(){
  const active=!!session?.connected;
  ui.inviteLabel.hidden=!active;
  ui.invite.value=active?inviteAddress(session.code):"";
  ui.share.disabled=!active;
}
ui.invite.addEventListener("focus",()=>ui.invite.select());
ui.share.addEventListener("click",async()=>{
  if(!session?.connected)return;
  const address=inviteAddress(session.code);
  showInvite();
  const result=await shareInvite(address);
  if(result==="shared"||result==="cancelled")return;
  if(result==="copied"){say("招待URLをコピーしました","online");return;}
  {
    ui.invite.focus();
    ui.invite.select();
    try{ui.invite.setSelectionRange(0,address.length);}catch{}
    say("招待URLを選択しました。長押ししてコピーしてください","online");
  }
});
// Creation has explicit mode buttons; old PvP invite hashes only affect joining.
ui.create.addEventListener("click",()=>{ui.mode.value="coop";void joinRoom(randomCode(),true,"coop");});
ui.createVersus.addEventListener("click",()=>{ui.mode.value="versus";void joinRoom(randomCode(),true,"versus");});
ui.join.addEventListener("click",()=>{
  const code=validCode(ui.code.value);
  if(!code){say("ルームコードは英数字8文字です","error");return;}
  joinRoom(code);
});
ui.leave.addEventListener("click",()=>leaveRoom());
if(!configured){
  ui.create.disabled=true;ui.createVersus.disabled=true;ui.join.disabled=true;
  say("Firebase未設定：現在は1人用です。設定後は各端末から同じルームへ参加できます。");
} else {
  // Explicit opt-in: do not load Firebase SDK or authenticate just because
  // a player opened the field. Loading begins only after Create/Join.
  setAvailable(true);
  ui.leave.disabled=true;ui.share.disabled=true;
  say("ルーム機能を利用する場合は、作成または参加を選んでください");
}
async function initFirebase(){
  const v="12.11.0",prefix="https://www.gstatic.com/firebasejs/"+v+"/";
  const [core,authSDK,network]=await Promise.all([
    import(prefix+"firebase-app.js"),
    import(prefix+"firebase-auth.js"),
    import(prefix+"firebase-database.js")
  ]);
  app=core.getApps().find(item=>item.options.projectId===firebaseConfig.projectId)||core.initializeApp(firebaseConfig);
  auth=authSDK.getAuth(app);
  db=network.getDatabase(app);
  api={...network,signInAnonymously:authSDK.signInAnonymously};
  setAvailable(true);
  say("準備完了：ルーム作成、またはコードで参加");
}
async function ensureReady(){
  if(!api)throw new Error("Firebaseの読み込み中です");
  await auth.authStateReady?.();
  if(!auth.currentUser)await api.signInAnonymously(auth);
  if(!auth.currentUser)throw new Error("匿名認証に失敗しました");
}
function setAvailable(connected){
  ui.create.disabled=!connected||!!session;ui.createVersus.disabled=!connected||!!session;ui.join.disabled=!connected||!!session;ui.mode.disabled=!connected||!!session;
  ui.leave.disabled=!connected;ui.share.disabled=!session?.connected;
}
async function leaveRoom(){
  const leaving=session;
  if(leaving?.host&&leaving.connected&&leaving.combatReady){port.pauseCoop?.();await Promise.race([(async()=>{try{await leaving.npcWritePromise;}catch{}await publishNpc(leaving,true);})(),new Promise(resolve=>setTimeout(resolve,1000))]);}
  ++token;stopCombatRetry();
  if(sendTimer){clearInterval(sendTimer);sendTimer=null;}
  if(unsubConnection){unsubConnection();unsubConnection=null;}
  if(unsubRoom){unsubRoom();unsubRoom=null;}
  stopNpcSync(session);
  const old=session;session=null;lastSent=null;lastWriteAt=0;
  port.clearPeers();port.setRoomActive?.(false);
  if(unsubCombat){unsubCombat();unsubCombat=null;}
  if(unsubClock){unsubClock();unsubClock=null;}
  port.disableCombat?.();combatSay('攻撃同期：未接続');npcSay("");
  if(old?.combatRef&&api){try{await api.remove(old.combatRef);await api.onDisconnect(old.combatRef).cancel();}catch{}}
  showInvite();
  if(old?.selfRef && api){
    let removed=false;
    try{await api.remove(old.selfRef);removed=true;}catch{}
    // If remove failed during network loss, retain onDisconnect until RTDB sees disconnect.
    if(removed)try{await api.onDisconnect(old.selfRef).cancel();}catch{}
  }
  setAvailable(false);
  if(api)setAvailable(true);ui.leave.disabled=true;
  say("退出しました。ほかの端末には影響しません");
}
function connectionId() {
  const b=new Uint8Array(12);crypto.getRandomValues(b);
  return "P"+Array.from(b,v=>v.toString(16).padStart(2,"0")).join("");
}
async function joinRoom(raw,creating=false,explicitMode=null) {
  const mode=explicitMode||(ui.mode.value==="coop"?"coop":"versus");
  const code=validCode(raw);
  if(!code){say("正しい8文字のルームコードを入力してください","error");return;}
  if(!api) {
    try { await initFirebase(); }
    catch(e){say("Firebaseの読込に失敗："+(e?.message||e),"error");return;}
  }
  if(session)await leaveRoom();
  const current=++token;
  sequence=0;combatSeq=0;setAvailable(false);say("匿名認証と接続を確認しています…");
  try{
    await ensureReady();
    if(current!==token)return;
    const id=connectionId();
    let meta=null;
    if(mode==="coop"){
      const metaRef=api.ref(db,"fieldCoop/"+code+"/meta");
      const snap=await api.get(metaRef).catch(e=>{throw Error("協力部屋確認（fieldCoop/meta）："+e.message+"（最新Firebaseルール確認）");});
      if(creating){
        if(snap.exists())throw Error("コードが既に存在します。新規作成をやり直してください");
        meta={owner:auth.currentUser.uid,connection:id,createdAt:api.serverTimestamp()};
        await api.set(metaRef,meta).catch(e=>{throw Error("協力部屋作成（fieldCoop/meta）："+e.message+"（最新Firebaseルール確認）");});
      }else{
        if(!snap.exists())throw Error("協力部屋が見つかりません。モードとコードを確認してください");
        meta=snap.val();
      }
      if(current!==token)return;
    }
    const playersRef=api.ref(db,(mode==="coop"?"coopPlayers/":"rooms/")+code+"/players");
    const selfRef=api.child(playersRef,id);
    session={code,id,selfRef,playersRef,mode,creator:creating,host:false,meta,hostId:meta?.connection,players:{},count:0,connected:false,publishing:false,
      npcJournal:createNpcJournal(),npcRevision:0,npcWriting:false,npcLastAt:0,npcSeen:0,npcBaseline:true,hostPresent:false,npcReady:false,npcReceivedAt:0};
    ui.code.value=code;
    ui.name.value=ui.name.value.trim().slice(0,16)||"プレイヤー";
    storage.set("gedo-room-name",ui.name.value);
    storage.set("gedo-room-color",ui.color.value);
    history.replaceState(null,"",location.pathname+location.search+(mode==="coop"?"#coop=":"#room=")+code);
    unsubRoom=api.onValue(playersRef,snap=>{
      if(current!==token)return;
      const items=snap.val()||{},entries=Object.entries(items).slice(0,40).map(([id,item])=>({id,...item}));
      session.count=entries.length;
      session.players=items;
      if(session.mode==="coop")void reconcileNpc(session);
      port.setPeers(entries,id);
      if(session.connected)say("接続中："+session.count+"人が同じフィールドにいます","online");
    },e=>say("共有フィールドの読込エラー："+e.message,"error"));
    unsubClock=api.onValue(api.ref(db,'.info/serverTimeOffset'),snap=>{serverOffset=Number(snap.val())||0;});
    unsubConnection=api.onValue(api.ref(db,".info/connected"),async snap=>{
      if(current!==token)return;
      if(!snap.val()){
        stopCombatRetry();session.connected=false;session.publishing=false;showInvite();
        session.combatReady=false;port.pauseCoop?.();stopNpcSync(session);session.host=false;session.npcReady=false;port.disableCombat?.();if(unsubCombat){unsubCombat();unsubCombat=null;}combatSay('攻撃同期：再接続待ち');
        say("通信が切れました。自動再接続を試みます","error");
        return;
      }
      try{
        // Register server-side cleanup BEFORE publishing the player's location.
        await api.onDisconnect(selfRef).remove();
        if(current!==token)return;
        await api.set(selfRef,selfState());
        if(current!==token)return;
        const active=session;
        if(mode==="coop"){
          npcSay("協力戦闘：CPU敵データ準備中");
          const self=(await api.get(selfRef)).val();
          if(current!==token)return;
          if(!self||self.owner!==auth.currentUser.uid)throw Error("協力参加者の登録を確認できません");
          active.players={...active.players,[id]:self};
          const stateRef=api.ref(db,"fieldCoop/"+code+"/state");
          const boot=await bootstrapCoop({
           read:async()=>(await api.get(stateRef)).val(),
           write:row=>api.set(stateRef,row),
           initial:()=>port.getInitialCoopSnapshot?.(),
           creator:active.creator&&active.hostId===id,id,timestamp:()=>api.serverTimestamp()
          }).catch(e=>{throw Error("CPU初期化（fieldCoop/state）："+e.message);});
          if(current!==token)return;
          active.latestNpc=boot?.row||null;
          // Never replace solo enemies with an empty view while the initial state is being written.
          if(!boot&&active.creator)throw Error("CPU初期データがありません");
          port.setRoomActive?.(true);port.setCoopRole?.("guest");port.pauseCoop?.();
          if(boot)port.setCoopSnapshot?.(boot.enemies);
          npcSay(boot?"協力戦闘：敵"+boot.enemies.length+"体・攻撃同期準備中":"協力戦闘：CPU初期化待ち");
        }else port.setRoomActive?.(true);
        session.connected=true;session.publishing=false;lastWriteAt=Date.now();showInvite();
        say("参加しました：ルーム "+code,"online");
        connectCombat(session,current);
      }catch(e){
        if(current!==token)return;
        const message="参加に失敗："+e.message;
        await leaveRoom();say(message,"error");npcSay(message);
      }
    },e=>say("接続確認エラー："+e.message,"error"));
    sendTimer=setInterval(()=>publish(current),100);
    setAvailable(true);
    ui.leave.disabled=false;showInvite();
  }catch(e){if(current===token){await leaveRoom();say("参加できません："+(e?.message||e),"error");}}
}
function connectCombat(active,expected){
  if(session!==active||expected!==token||!active.connected||active.combatReady||active.combatStarting)return;
  stopCombatRetry();active.combatStarting=true;
  startCombat(active,expected).catch(e=>{
    if(session!==active||expected!==token)return;
    active.combatReady=false;port.pauseCoop?.();stopNpcSync(active);active.host=false;active.npcReady=false;port.disableCombat?.();
    combatSay("攻撃同期：接続失敗 / "+(e?.message||e)+"（"+(active.mode==="coop"?"coopCombat":"fieldCombat")+"）");
    if(active.mode==="coop")npcSay("敵は表示中・攻撃同期失敗："+(e?.message||e));
    console.warn("field combat",e?.message);
    if(active.connected)combatRetry=setTimeout(()=>connectCombat(active,expected),5000);
  }).finally(()=>{active.combatStarting=false;});
}
async function startCombat(active,expected){
  if(!port.receiveAttack||!port.enableCombat)return;
  const combatRoot=(active.mode==="coop"?"coopCombat/":"fieldCombat/")+active.code;
  const combatRef=api.ref(db,combatRoot+"/"+active.id);
  active.combatRef=combatRef;
  if(unsubCombat){unsubCombat();unsubCombat=null;}
  await api.set(combatRef,{owner:auth.currentUser.uid,hp:100,seq:0,pose:motionPacket(port.getMotion?.())}).catch(e=>{throw Error("戦闘参加登録: "+e.message);});
  active.lastPose=null;active.lastPoseAt=0;active.poseWriting=false;
  if(session!==active||expected!==token){try{await api.remove(combatRef);}catch{}return;}
  await api.onDisconnect(combatRef).remove().catch(e=>{throw Error("切断時退出登録: "+e.message);});
  if(session!==active||expected!==token||!active.connected)return;
  port.enableCombat();active.combatReady=true;
  if(active.mode==="coop")startNpcSync(active,expected);
  const seen=new Map(),hitSeen=new Map();active.hitSeq=active.hitSeq||0;active.sentAttacks=0;active.receivedAttacks=0;
  function reportCombat(){if(active.combatReady)combatSay("攻撃同期：有効 · HP "+port.getHp()+"/100 · 送信 "+active.sentAttacks+" / 受信 "+active.receivedAttacks);}
  active.reportCombat=reportCombat;
  // First snapshot establishes a baseline; old attacks never replay on joining.
  let baseline=true;
  unsubCombat=api.onValue(api.ref(db,combatRoot),snap=>{
    if(session!==active||expected!==token||!active.connected)return;
    const rows=snap.val()||{},hps={};
    for(const [id,row] of Object.entries(rows)){
      if(id===active.id||!row)continue;
      if(Number.isInteger(row.hp)&&row.hp>=0&&row.hp<=100)hps[id]=row.hp;
      const result=recentAttackEvents(row,seen.get(id)||0,baseline,Date.now()+serverOffset);
      seen.set(id,result.lastSeq);
      for(const attack of result.events)if(port.receiveAttack(attack,id))active.receivedAttacks++;
      if(result.events.length)reportCombat();
      const hitResult=readHitEvents(row.hits,hitSeen.get(id)||0,baseline,Date.now()+serverOffset);
      hitSeen.set(id,hitResult.lastSeq);for(const hit of hitResult.events)port.receiveConfirmedHit?.(hit);
    }
    baseline=false;port.setPeerHp(hps);
    port.setPeerMotion?.(Object.fromEntries(Object.entries(rows).filter(([id,row])=>id!==active.id&&row?.pose).map(([id,row])=>[id,{pose:motionPacket(row.pose)}])));
  },e=>{if(session===active){active.combatReady=false;port.pauseCoop?.();stopNpcSync(active);active.host=false;active.npcReady=false;port.disableCombat();combatSay("攻撃同期：受信エラー "+e.message);stopCombatRetry();combatRetry=setTimeout(()=>connectCombat(active,expected),5000);}});
  reportCombat();
}
function stopNpcSync(active){
 if(!active)return;
 active.npcGeneration=(active.npcGeneration||0)+1;
 if(active.unsubNpc){active.unsubNpc();active.unsubNpc=null;}
 if(active.unsubMeta){active.unsubMeta();active.unsubMeta=null;}
}
function startNpcSync(active,expected){
 stopNpcSync(active);
 active.npcRef=api.ref(db,"fieldCoop/"+active.code+"/state");
 active.metaRef=api.ref(db,"fieldCoop/"+active.code+"/meta");
 active.host=false;active.npcReady=false;active.npcRetryAt=0;active.npcBaseline=true;active.npcHitSeen=0;
 npcSay("協力戦闘：管理者確認中");
 port.setCoopRole?.("guest");port.pauseCoop?.();
 active.unsubMeta=api.onValue(active.metaRef,snap=>{
  if(session!==active||expected!==token||!active.combatReady)return;
  active.meta=snap.val();active.hostId=active.meta?.connection;
  if(active.host&&active.hostId!==active.id){active.host=false;active.npcReady=false;port.setCoopRole?.("guest");port.pauseCoop?.();}
  void reconcileNpc(active);
 },e=>{if(session===active){port.pauseCoop?.();npcSay("CPU管理者同期エラー："+e.message);}});
 active.unsubNpc=api.onValue(active.npcRef,snap=>{
  if(session!==active||expected!==token||!active.connected||!active.combatReady)return;
  const row=snap.val();if(!row)return;
  const result=readNpcSnapshot(row.payload,active.npcSeen,active.npcBaseline,Date.now()+serverOffset);
  if(!result)return;
  active.latestNpc=row;
  if(active.host)return;
  // Keep the last visible enemy state during host handover; do not respawn.
  port.setCoopSnapshot?.(result.enemies);
  if(row.writer!==active.hostId||chooseCoopLeader(active.meta,active.players,Date.now()+serverOffset)!==active.hostId||Date.now()+serverOffset-row.updatedAt>5000){
   port.pauseCoop?.();active.npcReady=false;npcSay("CPU管理者交代中・敵HP維持");return;
  }
  if(active.hostId===active.id){port.pauseCoop?.();return;}
  const confirmed=readHitEvents(result.hits,active.npcHitSeen||0,active.npcBaseline,Date.now()+serverOffset);
  active.npcHitSeen=confirmed.lastSeq;
  active.npcSeen=result.lastSeq;active.npcBaseline=false;active.npcReady=true;active.npcReceivedAt=Date.now();
  port.setCoopRole?.("guest");port.setCoopSnapshot?.(result.enemies);
  for(const detail of result.events)port.receiveNpcAttack?.(detail);
  for(const hit of confirmed.events)port.receiveConfirmedHit?.(hit);
 },e=>{if(session===active){port.pauseCoop?.();active.npcReady=false;npcSay("CPU同期エラー："+e.message);}});
 void reconcileNpc(active);
}
async function reconcileNpc(active){
 if(session!==active||active.mode!=="coop"||!active.connected||!active.combatReady||!active.metaRef||!active.meta||active.electing||Date.now()<(active.electRetryAt||0))return;
 const now=Date.now()+serverOffset,leader=chooseCoopLeader(active.meta,active.players,now);
 if(leader!==active.hostId){active.npcReady=false;port.pauseCoop?.();npcSay("CPU管理者交代中・敵HP維持");}
 if(leader!==active.id)return;
 if(active.host&&active.hostId===active.id)return;
 active.electing=true;
 const generation=active.npcGeneration;
 const current=()=>session===active&&active.connected&&active.combatReady&&active.npcGeneration===generation;
 try{
  if(active.hostId!==active.id){
   const observed=active.hostId;
   const election=await api.runTransaction(active.metaRef,meta=>{
    if(!meta||meta.connection!==observed)return;
    if(chooseCoopLeader(meta,active.players,Date.now()+serverOffset)!==active.id)return;
    return {...meta,owner:auth.currentUser.uid,connection:active.id};
   },{applyLocally:false});
   if(!current())return;
   if(!election.committed)return;
   active.meta=election.snapshot.val();active.hostId=active.meta.connection;
  }
  if(active.hostId!==active.id)return;
  // Read the committed checkpoint only AFTER acquiring authority. An empty
  // enemy list is a completed encounter, never a reason to respawn.
  const snap=await api.get(active.npcRef);if(!current()||active.hostId!==active.id)return;
  const row=snap.val();
  const parsed=row?readNpcSnapshot(row.payload,0,true,Date.now()+serverOffset):null;
  if(row&&!parsed)throw Error("保存された敵データを読み込めません");
  if(!port.restoreCoopSnapshot?.(row?parsed.enemies:null))throw Error("敵HPを復元できません");
  active.npcRevision=row?.revision||0;active.npcJournal=createNpcJournal(row?.payload);
  if(parsed)active.npcSeen=Math.max(active.npcSeen,parsed.lastSeq);
  active.host=true;active.npcReady=false;active.npcLastAt=0;active.npcLastPayload=null;active.npcRetryAt=0;
  port.setCoopRole?.("host");port.pauseCoop?.();
  await publishNpc(active,true);
 }catch(e){if(current()){active.electRetryAt=Date.now()+2000;active.npcReady=false;port.pauseCoop?.();npcSay("CPU管理者交代エラー："+e.message+"（最新Firebaseルール確認）");}}
 finally{active.electing=false;}
}
async function publishNpc(active,force=false){
 if(session!==active||!active.connected||!active.combatReady||!active.host||active.hostId!==active.id||!active.npcRef||active.npcWriting||(!force&&Date.now()<(active.npcRetryAt||0)))return;
 const enemies=port.getCoopSnapshot?.();if(!enemies)return;
 const payload=active.npcJournal.serialize(enemies),now=Date.now();
 if(!force&&active.npcReady&&payload===active.npcLastPayload&&now-active.npcLastAt<1000)return;
 active.npcWriting=true;
 const generation=active.npcGeneration;
 try{
  active.npcWritePromise=api.set(active.npcRef,{revision:++active.npcRevision,payload,writer:active.id,updatedAt:api.serverTimestamp()});
  await active.npcWritePromise;
  if(session===active&&active.connected&&active.combatReady&&active.npcGeneration===generation&&active.host&&active.hostId===active.id){active.npcLastPayload=payload;active.npcLastAt=now;if(!active.npcReady){active.npcReady=true;port.setCoopRole?.("host");npcSay("協力戦闘：同期成功・敵"+enemies.length+"体（管理端末）");}}
 }catch(e){if(session===active&&active.npcGeneration===generation){active.npcReady=false;active.npcRetryAt=Date.now()+3000;port.pauseCoop?.();npcSay("CPU同期エラー："+e.message+"（最新Firebaseルール確認）");}}
 finally{active.npcWriting=false;active.npcWritePromise=null;}
}
window.addEventListener("gedo-coop-confirmed-hit",event=>{
 const active=session;if(active?.host&&active.connected&&active.combatReady&&active.npcReady)active.npcJournal.appendHit(event.detail,Date.now()+serverOffset);
});
window.addEventListener("gedo-field-confirmed-hit",event=>{
 const active=session,hit=event.detail;
 if(!active?.connected||!active.combatReady||active.mode==="coop"||!hit.source||!hit.seq)return;
 const id=++active.hitSeq;
 // Owner-only receipt in the victim's existing combat row. No extra room permissions.
 api.update(active.combatRef,{["hits/e"+(id%16)]:{...hit,id,at:api.serverTimestamp()}}).catch(e=>{if(session===active)combatSay("命中確認同期：送信エラー "+e.message);});
});
window.addEventListener("gedo-coop-npc-attack",event=>{
 const active=session;if(active?.host&&active.connected&&active.combatReady&&active.npcReady)active.npcJournal.append(event.detail,Date.now()+serverOffset);
});
window.addEventListener("gedo-field-attack",event=>{
  const active=session;
  if(!active?.connected)return;
  if(active.mode==="coop"&&!active.npcReady){npcSay("CPU同期準備中");return;}
  if(!active.combatReady){combatSay("攻撃同期：未接続（fieldCombatのルール確認）");return;}
  const attack=attackPacket(event.detail);
  if(!attack)return;
  combatSeq=Math.max(combatSeq+1,Number(event.detail.castSeq)||0);
  api.update(active.combatRef,attackPatch(attack,combatSeq,api.serverTimestamp()))
    .then(()=>{if(session===active){active.sentAttacks++;active.reportCombat?.();}})
    .catch(e=>{if(session===active)combatSay("攻撃同期：送信エラー "+e.message);});
});
window.addEventListener("gedo-field-hp",event=>{
  const active=session,hp=event.detail;
  if(!active?.connected||!active.combatReady||!Number.isInteger(hp)||hp<0||hp>100)return;
  if(hp===0)combatSay("HP 0：初期位置に戻るボタンで復帰");else active.reportCombat?.();
  api.update(active.combatRef,{hp}).catch(e=>{if(session===active)combatSay("HP同期：送信エラー");});
});
async function publishPose(active){
  if(!active?.combatReady||active.poseWriting)return;
  const pose=motionPacket(port.getMotion?.()),key=JSON.stringify(pose),now=Date.now();
  if(active.lastPose===key&&now-active.lastPoseAt<750)return;
  active.poseWriting=true;
  try{await api.update(active.combatRef,{pose});active.lastPose=key;active.lastPoseAt=now;}
  catch(e){if(session===active)combatSay('状態同期：送信エラー '+e.message);}
  finally{active.poseWriting=false;}
}
async function publish(expected){
  if(!session||!session.connected||expected!==token)return;
  publishPose(session);
  if(session.mode==="coop"){
    void reconcileNpc(session);
    if(session.host)void publishNpc(session);
    else if(session.npcReady&&(chooseCoopLeader(session.meta,session.players,Date.now()+serverOffset)!==session.hostId||Date.now()-session.npcReceivedAt>5000)){session.npcReady=false;port.pauseCoop?.();npcSay("CPU管理者交代中・敵HP維持");}
  }
  if(session.publishing)return;
  const p=port.getSelf();
  const next={x:p.x,y:p.y,facing:p.facing,moving:!!p.moving};
  const now=Date.now();
  if(lastSent&&Math.hypot(next.x-lastSent.x,next.y-lastSent.y)<1.5&&
    next.facing===lastSent.facing&&next.moving===lastSent.moving&&now-lastWriteAt<4000)return;
  const target=session.selfRef;
  session.publishing=true;
  try{
    await api.set(target,selfState());
    lastSent=next;lastWriteAt=now;
  }catch(e){
    if(expected===token)say("位置同期に失敗："+(e?.message||e),"error");
  }finally{if(expected===token&&session)session.publishing=false;}
}
window.addEventListener("pagehide",()=>{if(session){if(session.combatRef)api?.remove(session.combatRef).catch(()=>{});api?.remove(session.selfRef).catch(()=>{});}});
