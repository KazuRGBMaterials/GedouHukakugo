/**
 * Deterministic host-authoritative arena simulation.
 * Does not import Firebase, DOM, timing or the existing battle core.
 * Two modes: cooperation = collect 6 crystals; versus = defeat the rival team.
 * Intended as a dedicated ONLINE prototype, not the full belt battle.
 */
export const ARENA_COLUMNS=12, ARENA_ROWS=8;
const crystals=Object.freeze([[3,2],[8,2],[5,4],[2,6],[9,6],[6,1]]);
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const cleanLabel=value=>String(value||"プレイヤー").slice(0,16).replace(/[\u0000-\u001f<>]/g,"");
const directions=Object.freeze({S:[0,1],SE:[1,1],E:[1,0],NE:[1,-1],N:[0,-1],NW:[-1,-1],W:[-1,0],SW:[-1,1]});
// New arrivals receive a free tile instead of sharing the original four spawns.
// Existing player positions and team membership never shift when someone joins.
const spawnY=Object.freeze([2,5,3,4,1,6,0,7]);
function spawnLocation(players,team,mode){
 const occupied=new Set(Object.values(players).map(p=>p.x+","+p.y));
 const xs=Array.from({length:ARENA_COLUMNS},(_,x)=>x);
 if(mode==="versus"&&team===1)xs.reverse();
 const crystalCells=new Set(crystals.map(([x,y])=>x+","+y));
 for(const avoidCrystal of [true,false])
  for(const x of xs)for(const y of spawnY){
   const key=x+","+y;
   if(!occupied.has(key)&&(!avoidCrystal||!crystalCells.has(key)))return {x,y};
  }
 // More participants than map cells can still join: an overlapping visual
 // spawn is preferable to silently excluding the 97th member.
 const n=Object.keys(players).length;
 return {x:n%ARENA_COLUMNS,y:Math.floor(n/ARENA_COLUMNS)%ARENA_ROWS};
}
export function initialArena(mode) {
 if(!["coop","versus"].includes(mode))throw Error("Unknown arena mode");
 return {schemaVersion:1,mode,tick:0,phase:"playing",winner:null,
   players:{},collected:[],goal:crystals.length};
}
export function updateArena(current,members={},inputs={}) {
 if(current?.schemaVersion!==1||!["coop","versus"].includes(current.mode))throw Error("Invalid arena");
 const state={...current,tick:current.tick+1,
   players:{...current.players},collected:[...current.collected]};
 if(state.phase!=="playing")return state;
 const ids=Object.keys(members).filter(x=>x.length<=128).sort();
 const activeIds=new Set(ids);
 for(const uid of Object.keys(state.players))
  if(!activeIds.has(uid))delete state.players[uid];
 // Team assignments remain stable for returning players, while new arrivals
 // join the smaller team. No fixed roster-size cap is imposed by the engine.
 const teamSize=[0,0];
 for(const player of Object.values(state.players))
  if(player.team===0||player.team===1)teamSize[player.team]++;
 for(const uid of ids){
  const original=state.players[uid];
  if(original){
   state.players[uid]={...original,label:cleanLabel(members[uid]?.label)};
   continue;
  }
  const team=current.mode==="coop"?0:(teamSize[0]<=teamSize[1]?0:1);
  teamSize[team]++;
  const {x,y}=spawnLocation(state.players,team,current.mode);
  state.players[uid]={
    x,y,hp:100,team,
    facing:"S",label:cleanLabel(members[uid]?.label),
    lastSeq:0,lastAttackTick:-20
  };
 }
 const inBounds=(x,y)=>x>=0&&x<ARENA_COLUMNS&&y>=0&&y<ARENA_ROWS;
 for(const uid of ids){
  const player=state.players[uid],intent=inputs[uid];
  if(!intent||!Number.isSafeInteger(intent.seq)||intent.seq<=player.lastSeq||!player.hp)continue;
  const dx=clamp(Math.trunc(Number(intent.dx)||0),-1,1),dy=clamp(Math.trunc(Number(intent.dy)||0),-1,1);
  // exactly one tile per host tick; diagonal movements are normalized by axis.
  const x=player.x+dx,y=player.y+dy;
  if((dx||dy)&&inBounds(x,y)) {
    player.x=x;player.y=y;
    const face=Object.entries(directions).find(([,vector])=>vector[0]===dx&&vector[1]===dy);
    if(face)player.facing=face[0];
  }
  player.lastSeq=intent.seq;
  if(current.mode==="coop"){
   for(const [index,position] of crystals.entries()){
    if(player.x===position[0]&&player.y===position[1]&&!state.collected.includes(index))
      state.collected.push(index);
   }
  }else if(intent.attack===true && state.tick-player.lastAttackTick>=4){
   player.lastAttackTick=state.tick;
   for(const enemy of Object.values(state.players)){
    if(enemy.team===player.team||enemy.hp<=0)continue;
    if(Math.max(Math.abs(enemy.x-player.x),Math.abs(enemy.y-player.y))<=1){
      enemy.hp=Math.max(0,enemy.hp-20);break;
    }
   }
  }
 }
 if(current.mode==="coop" && state.collected.length===crystals.length){
  state.phase="finished";state.winner="coop";
 }
 if(current.mode==="versus" && ids.length>=2){
  const alive=new Set(Object.values(state.players).filter(p=>p.hp>0).map(p=>p.team));
  if(alive.size===1){
   state.phase="finished";state.winner=String([...alive][0]);
  }
 }
 return state;
}
export function crystalPositions(){return crystals.map(x=>[...x]);}
