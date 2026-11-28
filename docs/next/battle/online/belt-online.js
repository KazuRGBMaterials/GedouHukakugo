import {shareInvite} from "../../runtime/invite-share.js?v=1";
import {createFirebaseGateway} from "../../cloud/firebase-service.js?v=4";
import {createBeltRoom} from "./belt-room.js?v=4";
import {ownedSide} from "./belt-engine.js?v=3";

// UI/transport adapter only. The same battle.js renders solo and multiplayer.
export function bindBeltOnline({onSnapshot,onLeave,onUnlock,onStatus}){
 const $=id=>document.getElementById(id),gateway=createFirebaseGateway();
 let room=null,state=null,members={},connecting=false,waiting=null,sending=false;
 const status=message=>{$("status").textContent=message;};
 const feedback=message=>{$("online-command-status").textContent=message;onStatus?.(message);};
 const prefill=new URLSearchParams(location.search).get("room");if(prefill)$("code").value=prefill.toUpperCase().slice(0,12);
 const currentSide=()=>state&&room?ownedSide(state,room.getUid()):null;
 function updateLobby(){
  const session=room?.getSession(),active=!!session;
  for(const id of ["coop","versus","join"])$(id).disabled=active||connecting||!gateway.realtimeConfigured;
  $("leave").disabled=!active;$("invite-label").hidden=!active;$("host-controls").hidden=!session?.host;
  $("prepare").disabled=!session?.host||state?.phase!=="lobby"||Object.keys(members).length<2;
  $("online-start").disabled=!session?.host||state?.phase!=="planning";
  $("size").disabled=state?.phase!=="lobby";$("enemies").disabled=state?.phase!=="lobby"||session?.meta.mode!=="coop";
  $("members").textContent=Object.values(members).map(m=>m.label).join("、")||"参加者なし";
  if(active){const u=new URL(location.href);u.searchParams.set("room",session.code);$("invite").value=u.href;$("code").value=session.code;}
 }
 function snapshot(next,session){
  const firstBattle=!state?.battle&&!!next.battle;
  state=next;
  const ack=next.acks?.[room.getUid()];if(waiting&&ack?.id===waiting){feedback(ack.message);waiting=null;}
  if(firstBattle)$("online-room").open=false;
  onSnapshot(next,{side:currentSide(),host:session.host,code:session.code});updateLobby();
 }
 async function connect(kind){
  if(connecting)return;onUnlock();connecting=true;updateLobby();status("Firebaseに接続しています…");
  try{
   const connection=await gateway.connect("realtime");
   room=createBeltRoom({connection,onStatus:status,onMembers:rows=>{members=rows;updateLobby();},onState:snapshot});
   const name=$("name").value;
   const code=kind==="join"?await room.join($("code").value,name):await room.create(kind,name);
   const url=new URL(location.href);url.searchParams.set("room",code);history.replaceState(null,"",url);
  }catch(e){await room?.leave();room=null;state=null;members={};onLeave();status(e.message);}
  finally{connecting=false;updateLobby();}
 }
 async function send(intent){
  if(sending||!currentSide())return;
  sending=true;feedback("操作を送信中…");
  try{
   const result=await room.send(intent);
   if(result.local)feedback(result.accepted?"予約を受理しました":"予約できません");
   else{waiting=result.id;const ack=state?.acks?.[room.getUid()];feedback(ack?.id===waiting?ack.message:"送信済み・ホストの受理待ち");if(ack?.id===waiting)waiting=null;}
  }catch(e){feedback(e.message);status(e.message);}finally{sending=false;}
 }
 const start=()=>room?.start().catch(e=>status(e.message));
 $("coop").onclick=()=>connect("coop");$("versus").onclick=()=>connect("versus");$("join").onclick=()=>connect("join");
 $("leave").onclick=async()=>{await room?.leave();room=null;state=null;members={};waiting=null;feedback("");onLeave();$("online-room").open=true;updateLobby();const url=new URL(location.href);url.searchParams.delete("room");history.replaceState(null,"",url);};
 $("prepare").onclick=()=>room.prepare({size:Number($("size").value),enemies:Number($("enemies").value)}).catch(e=>status(e.message));
 $("online-start").onclick=start;
 $("invite").onfocus=()=>$("invite").select();
 $("copy").onclick=async()=>{const result=await shareInvite($("invite").value);if(result==="copied")status("招待URLをコピーしました");else if(result==="manual"){$("invite").focus();$("invite").select();status("長押しして招待URLをコピーしてください");}};
 window.addEventListener("pagehide",()=>room?.leave().catch(()=>{}));
 updateLobby();if(!gateway.realtimeConfigured)status("Firebase Realtime Database未設定");
 return {send,start};
}
