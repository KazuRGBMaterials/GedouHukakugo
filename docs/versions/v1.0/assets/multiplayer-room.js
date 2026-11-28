import { firebaseConfig } from "./firebase-config.js";

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
  create:document.getElementById("room-create"),
  join:document.getElementById("room-join"),
  leave:document.getElementById("room-leave"),
  share:document.getElementById("room-share"),
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
  if(state==="online")ui.summary.textContent="ROOM "+session.code+" · "+session.count+"人";
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
const configured=!!(firebaseConfig&&firebaseConfig.apiKey&&firebaseConfig.projectId&&firebaseConfig.appId&&firebaseConfig.databaseURL);
const savedName=storage.get("gedo-room-name","");
ui.name.value=savedName||("MAGE-"+String(Math.floor(Math.random()*90)+10));
ui.color.value=storage.get("gedo-room-color","0");
const fragment=(location.hash.match(/room=([A-HJ-NP-Z2-9]{8})/i)||[])[1];
if(fragment)ui.code.value=fragment.toUpperCase();
ui.panel.addEventListener("touchmove",event=>event.stopPropagation(),{passive:true});
window.addEventListener("keydown",event=>{if(event.key==="Escape"&&!ui.panel.hidden)ui.panel.hidden=true;});
ui.toggle.addEventListener("click",()=>{ui.panel.hidden=!ui.panel.hidden;});
ui.dismiss.addEventListener("click",()=>{ui.panel.hidden=true;});
ui.name.addEventListener("change",()=>storage.set("gedo-room-name",ui.name.value.trim().slice(0,16)));
ui.color.addEventListener("change",()=>storage.set("gedo-room-color",ui.color.value));
ui.code.addEventListener("input",()=>{ui.code.value=ui.code.value.toUpperCase().replace(/[^A-Z2-9]/g,"").slice(0,8);});
ui.share.addEventListener("click",async()=>{
  if(!session)return;
  const address=location.origin+location.pathname+location.search+"#room="+session.code;
  try{await navigator.clipboard.writeText(address);say("招待リンクをコピーしました","online");}
  catch{say("招待コード："+session.code+"（別端末で入力してください）","online");}
});
ui.create.addEventListener("click",()=>joinRoom(randomCode()));
ui.join.addEventListener("click",()=>{
  const code=validCode(ui.code.value);
  if(!code){say("ルームコードは英数字8文字です","error");return;}
  joinRoom(code);
});
ui.leave.addEventListener("click",()=>leaveRoom());
if(!configured){
  ui.create.disabled=true;ui.join.disabled=true;
  say("Firebase未設定：現在は1人用です。設定後は各端末から同じルームへ参加できます。");
} else {
  say("オンライン接続を準備しています");
  initFirebase().catch(e=>say("Firebaseの読込に失敗："+(e?.message||e),"error"));
}
async function initFirebase(){
  const v="12.11.0",prefix="https://www.gstatic.com/firebasejs/"+v+"/";
  const [core,authSDK,network]=await Promise.all([
    import(prefix+"firebase-app.js"),
    import(prefix+"firebase-auth.js"),
    import(prefix+"firebase-database.js")
  ]);
  app=core.initializeApp(firebaseConfig);
  auth=authSDK.getAuth(app);
  db=network.getDatabase(app);
  api={...network,signInAnonymously:authSDK.signInAnonymously};
  setAvailable(true);
  say("準備完了：ルーム作成、またはコードで参加");
}
async function ensureReady(){
  if(!api)throw new Error("Firebaseの読み込み中です");
  if(!auth.currentUser)await api.signInAnonymously(auth);
  if(!auth.currentUser)throw new Error("匿名認証に失敗しました");
}
function setAvailable(connected){
  ui.create.disabled=!connected;ui.join.disabled=!connected;
  ui.leave.disabled=!connected;ui.share.disabled=!connected;
}
async function leaveRoom(){
  ++token;
  if(sendTimer){clearInterval(sendTimer);sendTimer=null;}
  if(unsubConnection){unsubConnection();unsubConnection=null;}
  if(unsubRoom){unsubRoom();unsubRoom=null;}
  const old=session;session=null;lastSent=null;lastWriteAt=0;
  port.clearPeers();
  if(old?.selfRef && api){
    let removed=false;
    try{await api.remove(old.selfRef);removed=true;}catch{}
    // If remove failed during network loss, retain onDisconnect until RTDB sees disconnect.
    if(removed)try{await api.onDisconnect(old.selfRef).cancel();}catch{}
  }
  setAvailable(false);
  if(api)setAvailable(true);
  say("退出しました。ほかの端末には影響しません");
}
function connectionId() {
  const b=new Uint8Array(12);crypto.getRandomValues(b);
  return "P"+Array.from(b,v=>v.toString(16).padStart(2,"0")).join("");
}
async function joinRoom(raw) {
  const code=validCode(raw);
  if(!code){say("正しい8文字のルームコードを入力してください","error");return;}
  if(!api){say("Firebase接続が未設定、または読み込み中です","error");return;}
  if(session)await leaveRoom();
  const current=++token;
  sequence=0;setAvailable(false);say("匿名認証と接続を確認しています…");
  try{
    await ensureReady();
    if(current!==token)return;
    const id=connectionId();
    const playersRef=api.ref(db,"rooms/"+code+"/players");
    const selfRef=api.child(playersRef,id);
    session={code,id,selfRef,playersRef,count:0,connected:false,publishing:false};
    ui.code.value=code;
    ui.name.value=ui.name.value.trim().slice(0,16)||"プレイヤー";
    storage.set("gedo-room-name",ui.name.value);
    storage.set("gedo-room-color",ui.color.value);
    history.replaceState(null,"",location.pathname+location.search+"#room="+code);
    unsubRoom=api.onValue(playersRef,snap=>{
      if(current!==token)return;
      const items=snap.val()||{},entries=Object.entries(items).slice(0,40).map(([id,item])=>({id,...item}));
      session.count=entries.length;
      port.setPeers(entries,id);
      if(session.connected)say("接続中："+session.count+"人が同じフィールドにいます","online");
    },e=>say("共有フィールドの読込エラー："+e.message,"error"));
    unsubConnection=api.onValue(api.ref(db,".info/connected"),async snap=>{
      if(current!==token)return;
      if(!snap.val()){
        session.connected=false;session.publishing=false;
        say("通信が切れました。自動再接続を試みます","error");
        return;
      }
      try{
        // Register server-side cleanup BEFORE publishing the player's location.
        await api.onDisconnect(selfRef).remove();
        if(current!==token)return;
        await api.set(selfRef,selfState());
        if(current!==token)return;
        session.connected=true;session.publishing=false;lastWriteAt=Date.now();
        say("参加しました：ルーム "+code,"online");
      }catch(e){say("参加に失敗："+e.message,"error");}
    },e=>say("接続確認エラー："+e.message,"error"));
    sendTimer=setInterval(()=>publish(current),125);
    setAvailable(true);
    ui.leave.disabled=false;ui.share.disabled=false;
  }catch(e){if(current===token){await leaveRoom();say("参加できません："+(e?.message||e),"error");}}
}
async function publish(expected){
  if(!session||!session.connected||session.publishing||expected!==token)return;
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
window.addEventListener("pagehide",()=>{if(session)api?.remove(session.selfRef).catch(()=>{});});
