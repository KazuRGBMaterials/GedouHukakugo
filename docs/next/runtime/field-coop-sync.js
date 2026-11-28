/** Transport-neutral bounded event journal. Each CPU attack has one unique sequence. */
import {attackPacket} from "./field-combat.js?v=10";
const MAX_EVENTS=32;
export function createNpcJournal(previous=null){
 let seq=0,events=[],hitSeq=0,hits=[];
 if(previous){try{const data=JSON.parse(previous);if(Array.isArray(data.events))for(const event of data.events.slice(-MAX_EVENTS)){const packet=attackPacket(event);if(packet&&Number.isSafeInteger(event.seq)&&event.seq>seq&&Number.isFinite(event.at)){seq=event.seq;events.push({...packet,seq,at:event.at});}}if(Array.isArray(data.hits))for(const hit of data.hits.slice(-MAX_EVENTS)){if(validHit(hit)&&hit.id>hitSeq){hits.push(hit);hitSeq=hit.id;}}}catch{}}
 return Object.freeze({
  append(detail,at){const packet=attackPacket(detail);if(!packet||!Number.isFinite(at))return false;events.push({...packet,seq:++seq,at});if(events.length>MAX_EVENTS)events.shift();return true;},
  appendHit(hit,at){const event={...hit,id:hitSeq+1,at};if(!validHit(event))return false;hitSeq++;hits.push(event);if(hits.length>MAX_EVENTS)hits.shift();return true;},
  serialize(enemies){return JSON.stringify({enemies,events,hits});}
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
 return {enemies:data.enemies,events,lastSeq,hits:Array.isArray(data.hits)?data.hits.slice(-MAX_EVENTS):[]};
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

/** A room is not presented as ready until its initial shared enemy checkpoint exists.
 * A reconnect may find a committed checkpoint: never overwrite it with fresh enemies.
 */
export async function bootstrapCoop({read,write,initial,creator,id,timestamp}){
 const existing=await read();
 if(existing!==null&&existing!==undefined){
  const result=readNpcSnapshot(existing.payload,0,true);
  if(!result)throw Error("CPU敵の保存データが不正です");
  return {row:existing,enemies:result.enemies};
 }
 if(!creator)return null;
 const enemies=initial();
 if(!Array.isArray(enemies)||enemies.length!==5||!enemies.some(e=>e.id==="hellor"&&e.hp===400))throw Error("CPU敵の初期データがありません");
 const row={revision:1,payload:createNpcJournal().serialize(enemies),writer:id,updatedAt:timestamp()};
 await write(row);
 return {row,enemies};
}

export function validHit(h){return !!h&&Number.isInteger(h.index)&&h.index>=0&&h.index<=3&&typeof h.source==="string"&&/^(local|P[a-f0-9]{24})$/.test(h.source)&&Number.isSafeInteger(h.seq)&&h.seq>0&&Number.isSafeInteger(h.id)&&h.id>0&&Number.isFinite(h.at)&&Number.isFinite(h.x)&&Number.isFinite(h.y)&&Number.isInteger(h.damage)&&h.damage>0&&h.damage<=30;}
export function readHitEvents(rows,seen=0,baseline=false,now=Date.now()){
 let lastSeq=seen;const events=[];
 for(const h of Object.values(rows||{}).filter(validHit).sort((a,b)=>a.id-b.id)){if(h.id<=lastSeq)continue;lastSeq=h.id;if(!baseline&&now-h.at<=2500&&h.at-now<=5000)events.push(h);}
 return {lastSeq,events};
}
