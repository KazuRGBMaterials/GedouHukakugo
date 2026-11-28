import {createBattle,COMMANDS,canReserve,reserve,isManual,shiftImpact,setQueuedTarget,setQueuedLanding,startBattle,advanceBattle as advanceCore} from "../../../battle/rules.js?v=17";
import {PARTY_SIDES,FOE_SIDES,gridSides,teamOf,normalizeGridSize} from "../../../battle/grid-rules.js?v=7";
import {withWaitHealthRecovery} from "../rest-recovery.js";
const advance=withWaitHealthRecovery(advanceCore,{sidesForBattle:gridSides});
export const sideName=(state,side)=>state.roster?.[side]?.label||(teamOf(side)==="enemy"?"ネームレス":"味方");
export function lobby(mode){
 if(!["coop","versus"].includes(mode))throw Error("不正な戦闘モード");
 return {schemaVersion:1,mode,phase:"lobby",revision:0,roster:{},feedback:{},acks:{},battle:null};
}
export function prepareBattle(state,members,hostUid,options={}){
 if(state.phase!=="lobby")return false;
 const ids=Object.keys(members).filter(id=>typeof members[id]?.label==="string").sort((a,b)=>(a===hostUid?-1:b===hostUid?1:0)||((members[a].joinedAt||0)-(members[b].joinedAt||0))||a.localeCompare(b));
 if(ids.length<2)throw Error("ホストを含め2人以上の参加が必要です");
 const roster={},label=id=>String(members[id].label).slice(0,16);
 let players=0,enemies=0;
 if(state.mode==="coop"){
  for(const id of ids.slice(0,PARTY_SIDES.length))roster[PARTY_SIDES[players++]]={uid:id,label:label(id)};
  enemies=Math.max(1,Math.min(4,Math.trunc(Number(options.enemies)||2)));
 }else{
  for(const id of ids.slice(0,PARTY_SIDES.length+FOE_SIDES.length)){
   const side=players<=enemies?PARTY_SIDES[players++]:FOE_SIDES[enemies++];
   roster[side]={uid:id,label:label(id)};
  }
 }
 const automatic=Object.fromEntries(PARTY_SIDES.map(s=>[s,false]));
 const manualEnemySides=state.mode==="versus"?FOE_SIDES.slice(0,enemies):[];
 const size=normalizeGridSize(options.size||7);
 state.battle=createBattle(true,{risk:"balanced",waste:"some",style:"power"},{
  players,enemies,columns:size,rows:size,automatic,manualEnemySides,
  enemyTactics:"standard",enemyName:state.mode==="coop"?"ネームレス":"対戦相手"
 });
 state.roster=roster;state.phase="planning";state.revision++;return true;
}
export function ownedSide(state,uid){return Object.keys(state.roster||{}).find(s=>state.roster[s].uid===uid)||null;}
export function cleanIntent(raw){
 const kind=raw?.kind;
 if(!["reserve","shift","target","landing"].includes(kind))return null;
 const command=String(raw.command||"");
 if(kind==="reserve"&&command!=="move"&&!Object.hasOwn(COMMANDS,command))return null;
 const x=Number.isInteger(raw.x)&&raw.x>=0&&raw.x<=30?raw.x:-1;
 const y=Number.isInteger(raw.y)&&raw.y>=0&&raw.y<=30?raw.y:-1;
 const target=[...PARTY_SIDES,...FOE_SIDES].includes(raw.target)?raw.target:"";
 if((kind==="landing"||command==="move")&&(x<0||y<0))return null;
 return {kind,command:kind==="reserve"?command:"",x,y,target};
}
export function applyIntent(state,uid,raw){
 const input=cleanIntent(raw),side=ownedSide(state,uid),b=state.battle;
 if(!input||!side||!b||!isManual(b,side)||b.phase==="finished"){
  state.feedback[uid]=!side?"操作枠がありません（観戦）":"現在は操作できません";state.revision++;return false;
 }
 const cell=input.x>=0&&input.y>=0?{x:input.x,y:input.y}:undefined;
 let accepted=false;
 if(input.kind==="reserve")accepted=reserve(b,side,input.command,cell,input.target||undefined);
 if(input.kind==="shift")accepted=shiftImpact(b,side);
 if(input.kind==="target")accepted=setQueuedTarget(b,side,input.target);
 if(input.kind==="landing")accepted=setQueuedLanding(b,side,cell);
 state.feedback[uid]=accepted?"入力を受理しました":"予約条件を満たしていません";
 state.revision++;
 return accepted;
}
export function beginBattle(state){
 if(state.phase!=="planning")return false;
 startBattle(state.battle);state.phase=state.battle.phase;state.revision++;return true;
}
export function tickBattle(state){
 if(state.phase!=="running")return false;
 advance(state.battle);state.phase=state.battle.phase;state.revision++;return true;
}
export function availableCommand(state,uid,id,cell){
 const side=ownedSide(state,uid),b=state.battle;
 return !!side&&!!b&&isManual(b,side)&&canReserve(b,side,id,cell);
}
