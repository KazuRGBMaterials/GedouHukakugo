/**
 * Firebase Realtime Database transport for host-authoritative online arena.
 * Owner simulates and publishes snapshots. Other players only send their own
 * bounded inputs; Security Rules prevent writing other players' inputs.
 */
import {makeRoomCode,normalizeRoomCode} from "../cloud/identity.js";
import {initialArena,updateArena} from "./arena-engine.js";
export function createOnlineRoom({connection,onStatus=()=>{},onState=()=>{},onMembers=()=>{}}){
 const {api,db,uid}=connection;
 let active=null,unsub=[],timer=null,writing=false,sequence=Math.floor(Date.now()/1000)%1000000000,lastSent=0;
 // Reduce no-op traffic as the room grows; movement still sends every tick.
 let lastInputKind=null,lastIdleAt=0;
 const roomRef=(code,field)=>api.ref(db,"arenaRooms/"+code+(field?"/"+field:""));
 const status=(message)=>onStatus(message);
 async function leave() {
  if(timer){clearInterval(timer);timer=null;}
  unsub.forEach(fn=>fn());unsub=[];
  const previous=active;active=null;
  lastInputKind=null;lastIdleAt=0;lastSent=0;
  if(previous){
   try{await api.remove(roomRef(previous.code,"members/"+uid));}catch{}
   try{await api.onDisconnect(roomRef(previous.code,"members/"+uid)).cancel();}catch{}
  }
  status("退出しました");
 }
 async function create(mode,label){
  if(!["coop","versus"].includes(mode))throw Error("モードが不正です");
  await leave();
  for(let attempt=0;attempt<5;attempt++){
   const code=makeRoomCode();
   const meta={owner:uid,mode,createdAt:api.serverTimestamp()};
   const transaction=await api.runTransaction(roomRef(code,"meta"),current=>{
     if(current!=null)return;
     return meta;
   },{applyLocally:false});
   if(!transaction.committed)continue;
   await enter(code,label,meta,true);
   return code;
  }
  throw Error("ルーム作成に失敗しました");
 }
 async function join(code,label){
  const room=normalizeRoomCode(code);
  if(!room)throw Error("招待コードは英数字12文字です");
  await leave();
  const snap=await api.get(roomRef(room,"meta"));
  if(!snap.exists())throw Error("ルームが見つかりません");
  const meta=snap.val();
  if(!meta||!["coop","versus"].includes(meta.mode))throw Error("ルーム設定が不正です");
  await enter(room,label,meta,false);
  return room;
 }
 async function enter(code,label,meta,host){
  const memberRef=roomRef(code,"members/"+uid);
  const member={label:String(label||"プレイヤー").trim().slice(0,16)||"プレイヤー",
    joinedAt:api.serverTimestamp()};
  // Register cleanup before marking online.
  await api.onDisconnect(memberRef).remove();
  try{await api.set(memberRef,member);}catch(error){
   try{await api.onDisconnect(memberRef).cancel();}catch{}
   throw error;
  }
  const session={code,meta,host,mode:meta.mode,state:initialArena(meta.mode),
    members:{},inputs:{}};
  active=session;
  unsub.push(api.onValue(roomRef(code,"members"),snap=>{
    if(active!==session)return;
    session.members=snap.val()||{};
    onMembers(session.members,session);
  },e=>status("参加者の同期エラー："+e.message)));
  unsub.push(api.onValue(roomRef(code,"state"),snap=>{
    if(active!==session)return;
    const data=snap.val();
    if(data?.payload && typeof data.payload==="string"){
      try{
       const next=JSON.parse(data.payload);
       if(next.schemaVersion===1&&next.mode===meta.mode&&Number.isSafeInteger(next.tick)
         &&(!session.host||next.tick>=session.state.tick)){
         session.state=next;
         onState(session.state,session);
       }
      }catch{status("同期データを読み込めません");}
    }
  },e=>status("状態の購読エラー："+e.message)));
  if(host){
   unsub.push(api.onValue(roomRef(code,"inputs"),snap=>{
     if(active===session)session.inputs=snap.val()||{};
   },e=>status("操作受信エラー："+e.message)));
   let lastPublishedFingerprint=null,lastPublishedAt=0;
   timer=setInterval(async()=>{
    if(active!==session||writing)return;
    writing=true;
    try{
     session.state=updateArena(session.state,session.members,session.inputs);
     // Game tick counts advance locally for cooldowns, but idle ticks do
     // not justify resending the full roster to every participant.
     const fingerprint=JSON.stringify({...session.state,tick:0});
     const now=Date.now();
     if(fingerprint===lastPublishedFingerprint && now-lastPublishedAt<15000)return;
     const payload=JSON.stringify(session.state);
     if(payload.length>18000)
      throw Error("ルーム状態が18KBを超えました。参加人数に合わせて同期方式の見直しが必要です");
     await api.set(roomRef(code,"state"),{
       tick:session.state.tick,payload,updatedAt:api.serverTimestamp()
     });
     lastPublishedFingerprint=fingerprint;lastPublishedAt=Date.now();
     onState(session.state,session);
    }catch(e){status("ホスト同期エラー："+e.message)}
    finally{writing=false;}
   },320);
  }
  status("ROOM "+code+" · "+(host?"ホスト":"参加者")+" · "+(meta.mode==="coop"?"協力":"対戦"));
 }
 async function sendInput({dx=0,dy=0,attack=false}={}){
  if(!active)return;
  const now=Date.now();
  if(now-lastSent<120)return;
  const safeDx=Math.max(-1,Math.min(1,Math.trunc(dx)));
  const safeDy=Math.max(-1,Math.min(1,Math.trunc(dy)));
  const action=!!attack;
  const kind=safeDx+","+safeDy+","+Number(action);
  // An unchanged, idle input is sent just once and then every 15 seconds.
  // Holding a direction or attack continues sending distinct sequences.
  if(!safeDx&&!safeDy&&!action&&kind===lastInputKind&&now-lastIdleAt<15000)return;
  const intent={seq:++sequence,dx:safeDx,dy:safeDy,
   attack:action,updatedAt:api.serverTimestamp()};
  await api.set(roomRef(active.code,"inputs/"+uid),intent);
  lastSent=now;lastInputKind=kind;
  if(!safeDx&&!safeDy&&!action)lastIdleAt=now;
 }
 return Object.freeze({create,join,leave,sendInput,
   getSession:()=>active,getSelfId:()=>uid});
}
