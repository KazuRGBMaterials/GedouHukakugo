/** Transport-neutral bounded event journal. Each CPU attack has one unique sequence. */
import {attackPacket} from "./field-combat.js?v=7";
const MAX_EVENTS=32;
export function createNpcJournal(previous=null){
 let seq=0,events=[];
 if(previous){try{const data=JSON.parse(previous);if(Array.isArray(data.events))for(const event of data.events.slice(-MAX_EVENTS)){const packet=attackPacket(event);if(packet&&Number.isSafeInteger(event.seq)&&event.seq>seq&&Number.isFinite(event.at)){seq=event.seq;events.push({...packet,seq,at:event.at});}}}catch{}}
 return Object.freeze({
  append(detail,at){const packet=attackPacket(detail);if(!packet||!Number.isFinite(at))return false;events.push({...packet,seq:++seq,at});if(events.length>MAX_EVENTS)events.shift();return true;},
  serialize(enemies){return JSON.stringify({enemies,events});}
 });
}
export function readNpcSnapshot(payload,seen=0,baseline=false,now=Date.now()){
 if(typeof payload!=="string"||payload.length>30000)return null;
 let data;try{data=JSON.parse(payload);}catch{return null;}
 if(!Array.isArray(data?.enemies)||data.enemies.length>5||!Array.isArray(data.events)||data.events.length>MAX_EVENTS)return null;
 let lastSeq=seen;const events=[];
 for(const event of data.events.slice().sort((a,b)=>(a?.seq||0)-(b?.seq||0))){
  if(!Number.isSafeInteger(event?.seq)||event.seq<=lastSeq)continue;
  const packet=attackPacket(event);if(!packet||!Number.isFinite(event.at))continue;
  lastSeq=event.seq;
  if(!baseline&&now-event.at<=2500&&event.at-now<=5000)events.push(packet);
 }
 return {enemies:data.enemies,events,lastSeq};
}

export const COOP_LEASE_MS=15000;
export function activeCoopPlayer(row,now){
 return !!row&&typeof row.owner==="string"&&Number.isFinite(row.updatedAt)&&now-row.updatedAt<=COOP_LEASE_MS&&row.updatedAt<=now+30000;
}
export function chooseCoopLeader(meta,players,now){
 const owner=players?.[meta?.connection];
 if(owner?.owner===meta?.owner&&activeCoopPlayer(owner,now))return meta.connection;
 return Object.keys(players||{}).filter(id=>/^P[a-f0-9]{24}$/.test(id)&&activeCoopPlayer(players[id],now)).sort()[0]||null;
}
