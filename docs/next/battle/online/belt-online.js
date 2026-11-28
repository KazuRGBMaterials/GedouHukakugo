import {shareInvite} from "../../runtime/invite-share.js?v=1";
import {createBattleAudio} from "../../../battle/audio.js?v=2";
import {victoryFanfare,createVictoryGate} from "../victory-fanfare.js?v=1";
import {createFirebaseGateway} from "../../cloud/firebase-service.js?v=4";
import {createBeltRoom} from "./belt-room.js?v=3";
import {ownedSide,sideName,availableCommand} from "./belt-engine.js?v=2";
import {COMMANDS,TIMELINE_SIZE,canShiftImpact,isManual,editableAttack} from "../../../battle/rules.js?v=17";
import {gridSides,teamOf,targetFor,jumpLandingCandidates} from "../../../battle/grid-rules.js?v=7";
const $=id=>document.getElementById(id),gateway=createFirebaseGateway();
let room=null,state=null,members={},selectedTarget=null,connecting=false;
let waiting=null,sending=false;
const audio=createBattleAudio(new Audio(),{victoryEffect:victoryFanfare});
const victory=createVictoryGate(()=>audio.play("victory"));
let soundEnabled=true;
$("battle-sound").addEventListener("click",()=>{
 soundEnabled=!soundEnabled;audio.setEnabled(soundEnabled);
 $("battle-sound").textContent="サウンド "+(soundEnabled?"ON":"OFF");
 $("battle-sound").setAttribute("aria-pressed",String(soundEnabled));
 if(soundEnabled)audio.unlock();
});
document.addEventListener("click",()=>audio.unlock(),{capture:true});
const status=message=>{$("status").textContent=message;};
const prefill=new URLSearchParams(location.search).get("room");if(prefill)$("code").value=prefill.toUpperCase().slice(0,12);
const button=(text,fn,css,existing)=>{const b=existing||document.createElement("button");b.type="button";b.textContent=text;b.className=css||"";b.onclick=fn;return b;};
function reconcileButtons(parent,buttons){
 for(let i=0;i<buttons.length;i++)if(parent.children[i]!==buttons[i])parent.insertBefore(buttons[i],parent.children[i]||null);
 while(parent.children.length>buttons.length)parent.lastElementChild.remove();
}
const showError=e=>status(e?.message||String(e));
function updateLobby(){
 const session=room?.getSession(),active=!!session;
 for(const id of ["coop","versus","join"])$(id).disabled=active||connecting||!gateway.realtimeConfigured;
 $("leave").disabled=!active;$("invite-label").hidden=!active;
 $("host-controls").hidden=!session?.host;
 $("prepare").disabled=!session?.host||state?.phase!=="lobby"||Object.keys(members).length<2;
 $("start").disabled=!session?.host||state?.phase!=="planning";
 $("size").disabled=state?.phase!=="lobby";$("enemies").disabled=state?.phase!=="lobby"||session?.meta.mode!=="coop";
 $("members").textContent=Object.values(members).map(m=>m.label).join("、")||"参加者なし";
 if(active){const u=new URL(location.href);u.searchParams.set("room",session.code);$("invite").value=u.href;$("code").value=session.code;}
}
async function connect(kind){
 if(connecting)return;audio.unlock();victory.reset();connecting=true;updateLobby();status("Firebaseに接続しています…");
 try{
  const connection=await gateway.connect("realtime");
  room=createBeltRoom({connection,onStatus:status,onMembers:(rows)=>{members=rows;updateLobby();},
   onState:(next,session)=>{state=next;const side=ownedSide(next,room?.getUid());const won=!!side&&(teamOf(side)==='enemy'?next.battle?.outcome==='敗北':next.battle?.outcome==='勝利');victory.observe(session?.code,next.battle?.phase,won);render();updateLobby();}});
  const name=$("name").value;
  const code=kind==="join"?await room.join($("code").value,name):await room.create(kind,name);
  const url=new URL(location.href);url.searchParams.set("room",code);history.replaceState(null,"",url);
 }catch(e){await room?.leave();room=null;state=null;members={};render();showError(e);}
 finally{connecting=false;updateLobby();}
}
async function send(intent){
 if(sending)return;
 sending=true;$("command-feedback").textContent="操作を送信中…";
 try{const result=await room.send(intent);if(result.local){$("command-feedback").textContent=result.accepted?"予約を受理しました":"予約できません";}else {waiting=result.id;const ack=state?.acks?.[room.getUid()];$("command-feedback").textContent=ack?.id===waiting?ack.message:"送信済み・ホストの受理待ち";if(ack?.id===waiting)waiting=null;}}
 catch(e){$("command-feedback").textContent=e.message;showError(e);}
 finally{sending=false;}
}
$("coop").addEventListener("click",()=>connect("coop"));$("versus").addEventListener("click",()=>connect("versus"));$("join").addEventListener("click",()=>connect("join"));
$("leave").addEventListener("click",async()=>{audio.stopEffects();victory.reset();await room?.leave();room=null;state=null;members={};selectedTarget=null;waiting=null;$("command-feedback").textContent="";render();updateLobby();const url=new URL(location.href);url.searchParams.delete("room");history.replaceState(null,"",url);});
$("prepare").addEventListener("click",()=>room.prepare({size:Number($("size").value),enemies:Number($("enemies").value)}).catch(showError));
$("start").addEventListener("click",()=>room.start().catch(showError));
$("shift").addEventListener("click",()=>send({kind:"shift"}));
$("invite").addEventListener("focus",()=>$("invite").select());
$("copy").addEventListener("click",async()=>{const result=await shareInvite($("invite").value);if(result==="copied")status("招待URLをコピーしました");else if(result==="manual"){$("invite").focus();$("invite").select();status("長押しして招待URLをコピーしてください");}});
function render(){
 const b=state?.battle,uid=room?.getUid();$("game").hidden=!b;if(!b)return;
 const side=ownedSide(state,uid),sides=gridSides(b),manual=side&&isManual(b,side)&&b.phase!=="finished";
 $("phase").textContent=b.phase==="finished"?(b.outcome==="相打ち"?"相打ち":state.mode==="versus"?(b.outcome==="勝利"?"味方側勝利":"敵側勝利"):b.outcome):b.phase==="planning"?"初手予約・準備中":b.tick+"枠経過";
 $("self").textContent=side?"操作："+sideName(state,side)+(manual?"（操作可能）":"（操作不可）"):"観戦：操作枠なし（準備開始前に参加してください）";
 const ack=state.acks?.[uid];if(waiting&&ack?.id===waiting){$("command-feedback").textContent=ack.message;waiting=null;}
 $("feedback").textContent=state.feedback?.[uid]||"";
 $("fighters").replaceChildren(...sides.map(id=>{
  const a=b[id],div=document.createElement("div");div.className="fighter"+(teamOf(id)==="enemy"?" foe":"")+(id===side?" mine":"");
  const name=document.createElement("strong");name.textContent=sideName(state,id);
  const line=document.createElement("div");line.textContent="HP "+a.hp+"/"+a.maxHp+" · ST "+a.stamina;
  const meter=document.createElement("div");meter.className="hp";const fill=document.createElement("i");fill.style.width=100*a.hp/a.maxHp+"%";meter.append(fill);div.append(name,line,meter);return div;
 }));
 if(side)selectedTarget=targetFor(b,side,selectedTarget);
 const editable=manual?editableAttack(b,side):null;
 const landing=editable?.commandId==="jumpSlash"&&selectedTarget?jumpLandingCandidates(b,side,selectedTarget):[];
 const board=$("board");board.style.gridTemplateColumns="repeat("+b.grid.columns+",max-content)";
 const cells=[];
 for(let y=0;y<b.grid.rows;y++)for(let x=0;x<b.grid.columns;x++){
  const cell={x,y},id=sides.find(s=>b[s].hp>0&&b.grid[s].x===x&&b.grid[s].y===y),opponent=!!side&&!!id&&teamOf(id)!==teamOf(side);
  const canMove=manual&&availableCommand(state,uid,"move",cell),canLand=manual&&landing.some(c=>c.x===x&&c.y===y);
  const label=id?sideName(state,id):String.fromCharCode(65+x)+(y+1);
  const btn=button(label,()=>{
   if(opponent){selectedTarget=id;if(editable)send({kind:"target",target:id});render();}
   else if(canLand)send({kind:"landing",...cell});
   else if(canMove)send({kind:"reserve",command:"move",...cell});
  },"cell"+(id?(teamOf(id)==="enemy"?" foe":" friend"):"")+(id===side?" mine":"")+(id&&id===selectedTarget?" aim":"")+(canMove?" move":"")+(canLand?" landing":""),board.children[cells.length]);
  btn.disabled=!(manual&&(opponent||canMove||canLand));btn.setAttribute("aria-label",label);cells.push(btn);
 }
 reconcileButtons(board,cells);
 $("target").textContent=side?(selectedTarget?"攻撃対象："+sideName(state,selectedTarget):"攻撃対象なし"):"";
 const commands=$("commands");reconcileButtons(commands,Object.entries(COMMANDS).map(([id,c],i)=>{
  const btn=button(c.name,()=>send({kind:"reserve",command:id,target:selectedTarget||""}),c.color||"",commands.children[i]);
  const detail=document.createElement("small");detail.textContent=c.tc+"枠 · ★"+c.impact+" · SC"+c.sc;btn.append(detail);
  btn.disabled=!manual||!availableCommand(state,uid,id);return btn;
 }));
 $("shift").disabled=!manual||!canShiftImpact(b,side);
 const tracks=[];
 for(const id of sides){
  const row=document.createElement("div");row.className="belt-row";const name=document.createElement("span");name.className="belt-name";name.textContent=sideName(state,id);row.append(name);
  for(let i=1;i<=TIMELINE_SIZE;i++){
   const tick=b.tick+i,a=b[id].actions.find(a=>a.start<=tick&&a.end>=tick);
   const beat=document.createElement("span"),cmd=COMMANDS[a?.commandId];
   beat.className="beat "+(cmd?.color||"")+(a?.impact===tick?" impact":"");
   beat.textContent=a?(a.impact===tick?"★":"")+(a.commandId==="move"?"移":(cmd?.name||"").slice(0,2)):String(tick);
   row.append(beat);
  }
  tracks.push(row);
 }
 $("belt").replaceChildren(...tracks);
 $("log").replaceChildren(...b.events.map(message=>{const p=document.createElement("p");p.className="log-entry";p.textContent=message;return p;}));
}
window.addEventListener("pagehide",()=>room?.leave().catch(()=>{}));
updateLobby();render();if(!gateway.realtimeConfigured)status("Firebase Realtime Database未設定");
