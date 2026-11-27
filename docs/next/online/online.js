import {createFirebaseGateway} from "../cloud/firebase-service.js?v=2";
import {createOnlineRoom} from "./room-adapter.js";
import {initialArena,ARENA_COLUMNS,ARENA_ROWS,crystalPositions} from "./arena-engine.js";
import {nextContent} from "../content/index.js?v=6";
import {createLayeredCanvas} from "../../shared/modkit/layered-canvas.js";
const $=id=>document.getElementById(id);
const gateway=createFirebaseGateway();
const canvas=$("arena"),ctx=canvas.getContext("2d");
const layered=createLayeredCanvas({onAssetReady:draw});
let room=null,state=initialArena("coop"),members={},currentCode=null;
let controls={dx:0,dy:0,attack:false},lastMessage="未接続";
const sprites={
  mage:nextContent.registry.get("characters","mage-next")?.graphics,
  nameless:nextContent.registry.get("characters","nameless")?.graphics
};
const status=message=>{$("online-status").textContent=message;lastMessage=message};
function displayMembers(value){
 members=value||{};
 const labels=Object.values(members).map(m=>String(m.label||"プレイヤー").slice(0,16));
 $("online-players").textContent="参加者 "+labels.length+"/4："+(labels.join("、")||"なし");
}
function draw(){
 const w=960,h=640,left=45,top=30,cell=67;
 ctx.clearRect(0,0,w,h);
 ctx.fillStyle="#0c1724";ctx.fillRect(0,0,w,h);
 ctx.fillStyle="#2a3544";ctx.fillRect(left,top,ARENA_COLUMNS*cell,ARENA_ROWS*cell);
 for(let y=0;y<ARENA_ROWS;y++)for(let x=0;x<ARENA_COLUMNS;x++){
  ctx.fillStyle=(x+y)%2?"#233944":"#263f47";
  ctx.fillRect(left+x*cell+1,top+y*cell+1,cell-2,cell-2);
 }
 const crystals=crystalPositions();
 if(state.mode==="coop"){
  for(let i=0;i<crystals.length;i++){
   if(state.collected.includes(i))continue;
   const [x,y]=crystals[i],cx=left+(x+.5)*cell,cy=top+(y+.5)*cell;
   ctx.save();ctx.translate(cx,cy);ctx.rotate(Math.PI/4);
   ctx.fillStyle="#74ead2";ctx.fillRect(-9,-9,18,18);
   ctx.fillStyle="#d6fff2";ctx.fillRect(-5,-5,7,7);ctx.restore();
  }
 }
 const self=room?.getSelfId();
 for(const [uid,player] of Object.entries(state.players)){
  const x=left+(player.x+.5)*cell,y=top+(player.y+.5)*cell;
  ctx.fillStyle=uid===self?"#93ffcf":"#f1d3a3";
  ctx.beginPath();ctx.ellipse(x,y+20,21,7,0,0,Math.PI*2);ctx.fill();
  const gfx=player.team===1?sprites.nameless:sprites.mage;
  if(!layered.draw(ctx,gfx,player.facing,x-24,y-37,48,62)){
   ctx.fillStyle=player.team===1?"#9b7ac9":"#e0b36c";
   ctx.beginPath();ctx.arc(x,y-8,18,0,Math.PI*2);ctx.fill();
  }
  ctx.textAlign="center";ctx.font="bold 13px system-ui";ctx.fillStyle="#ffffff";
  ctx.fillText(player.label||"プレイヤー",x,y-41,90);
  if(state.mode==="versus"){
   ctx.fillStyle="#7c253b";ctx.fillRect(x-23,y+26,46,5);
   ctx.fillStyle="#6cf0b1";ctx.fillRect(x-23,y+26,46*(player.hp/100),5);
  }
 }
 ctx.fillStyle="#e2efe9";ctx.font="bold 17px system-ui";ctx.textAlign="left";
 ctx.fillText(state.mode==="coop"?`協力 · 宝石 ${state.collected.length}/${state.goal}`:
   "対戦 · 敵チームを倒そう",45,608);
 ctx.font="13px system-ui";
 ctx.fillText("進行 "+state.tick+"  ·  "+(state.phase==="finished"?"ゲーム終了":"進行中"),340,608);
 if(state.phase==="finished"){
  ctx.fillStyle="#05121cdb";ctx.fillRect(230,220,500,160);
  ctx.textAlign="center";ctx.fillStyle="#fff1bb";ctx.font="bold 28px system-ui";
  ctx.fillText(state.mode==="coop"?"協力クリア！":"勝利チーム "+state.winner,480,304);
 }
}
function setConnected(active){
 for(const id of ["create-coop","create-pvp","join-room"])$(id).disabled=active||!gateway.realtimeConfigured;
 $("copy-room").disabled=!active;
 $("leave-room").disabled=!active;
}
setConnected(false);
if(!gateway.realtimeConfigured)status("Realtime DatabaseのURLが未設定：オンラインルームは無効です。Firestoreのクラウドセーブは別途利用できます");
else status("オンライン機能は任意です。作成または参加すると匿名認証が始まります");
const prefill=new URLSearchParams(location.search).get("room");
if(prefill)$("online-code").value=prefill.toUpperCase().slice(0,12);
function callbacks(connection){
 return createOnlineRoom({connection,
  onStatus:status,
  onMembers:displayMembers,
  onState:next=>{state=next;draw();}
 });
}
async function connectRoom(kind){
 setConnected(true);status("Firebase認証とルーム接続を確認しています…");
 try{
  const connection=await gateway.connect("realtime");
  if(!room)room=callbacks(connection);
  const name=$("online-name").value.trim().slice(0,16)||"プレイヤー";
  const code=kind==="join"?await room.join($("online-code").value,name)
    :await room.create(kind,name);
  currentCode=code;
  $("online-code").value=code;
  const url=new URL(location.href);url.searchParams.set("room",code);
  history.replaceState(null,"",url);
  setConnected(true);
  draw();
 }catch(error){status("接続エラー："+(error?.message||error));setConnected(false);}
}
$("create-coop").addEventListener("click",()=>connectRoom("coop"));
$("create-pvp").addEventListener("click",()=>connectRoom("versus"));
$("join-room").addEventListener("click",()=>connectRoom("join"));
$("leave-room").addEventListener("click",async()=>{
 try{await room?.leave();}finally{
  room=null;currentCode=null;state=initialArena("coop");displayMembers({});setConnected(false);draw();
 }
});
$("copy-room").addEventListener("click",async()=>{
 if(!currentCode)return;
 const link=new URL(location.href);link.searchParams.set("room",currentCode);
 try{await navigator.clipboard.writeText(link.href);status("招待URLをコピーしました");}
 catch{status("招待コード："+currentCode);}
});
const pressed=new Set();
function movement(){
 const dx=Number(pressed.has("arrowright")||pressed.has("d"))-
          Number(pressed.has("arrowleft")||pressed.has("a"));
 const dy=Number(pressed.has("arrowdown")||pressed.has("s"))-
          Number(pressed.has("arrowup")||pressed.has("w"));
 controls.dx=dx;controls.dy=dy;
}
window.addEventListener("keydown",event=>{
 const target=event.target?.tagName;
 if(["INPUT","TEXTAREA","SELECT"].includes(target))return;
 const key=event.key.toLowerCase();
 if(["arrowright","arrowleft","arrowup","arrowdown","w","a","s","d"].includes(key)){
  event.preventDefault();pressed.add(key);movement();
 }else if(event.code==="Space"){event.preventDefault();controls.attack=true;}
});
window.addEventListener("keyup",event=>{
 const key=event.key.toLowerCase();
 pressed.delete(key);movement();
 if(event.code==="Space")controls.attack=false;
});
window.addEventListener("blur",()=>{pressed.clear();movement();controls.attack=false});
for(const button of document.querySelectorAll("[data-dir]")){
 const [dx,dy]=button.dataset.dir.split(",").map(Number);
 const start=event=>{event.preventDefault();button.setPointerCapture?.(event.pointerId);controls.dx=dx;controls.dy=dy};
 const stop=()=>{controls.dx=0;controls.dy=0};
 button.addEventListener("pointerdown",start);
 button.addEventListener("pointerup",stop);
 button.addEventListener("pointercancel",stop);
 button.addEventListener("lostpointercapture",stop);
}
$("online-attack").addEventListener("pointerdown",event=>{
 event.preventDefault();controls.attack=true;
 $("online-attack").setPointerCapture?.(event.pointerId);
});
for(const name of ["pointerup","pointercancel","lostpointercapture"])
 $("online-attack").addEventListener(name,()=>{controls.attack=false});
setInterval(()=>{
 if(!room?.getSession())return;
 room.sendInput(controls).catch(error=>status("操作送信エラー："+error.message));
},300);
window.addEventListener("pagehide",()=>{room?.leave().catch(()=>{});});
draw();
