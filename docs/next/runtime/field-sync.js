/** Network-neutral field motion and ordered attack-event helpers. */
const faces=["N","NE","E","SE","S","SW","W","NW"];
const clamp=(v,min,max)=>Math.min(max,Math.max(min,Number(v)||0));
export const EVENT_SLOTS=16;
export function motionPacket(raw={}){
 return {height:Math.round(clamp(raw.height,0,64)*10)/10,airborne:!!raw.airborne,
  action:Number.isInteger(raw.action)&&raw.action>=0&&raw.action<=3?raw.action:-1,
  charge:!!raw.charge,angle:Math.round(clamp(raw.angle,-Math.PI,Math.PI)*100)/100,
  chargeSeconds:Math.round(clamp(raw.chargeSeconds,0,1.4)*100)/100,
  dash:!!raw.dash,facing:faces.includes(raw.facing)?raw.facing:"S"};
}
export function attackPatch(attack,seq,at){
 if(!Number.isSafeInteger(seq)||seq<1)throw Error("Invalid attack sequence");
 return {seq,attack:{...attack,at},["events/e"+(seq%EVENT_SLOTS)]:{...attack,seq,at}};
}
// Read every unseen event in order, even if several writes were coalesced.
// Old clients may only publish the last attack. Do not replay initial history.
export function recentAttackEvents(row,lastSeq=0,baseline=false,now=Date.now()){
 const events=Object.values(row?.events||{}).filter(e=>e&&Number.isSafeInteger(e.seq)&&e.seq>0);
 if(Number.isSafeInteger(row?.seq)&&row.seq>0&&row.attack&&!events.some(e=>e.seq===row.seq))
  events.push({...row.attack,seq:row.seq});
 events.sort((a,b)=>a.seq-b.seq);
 let next=lastSeq;const fresh=[];
 for(const e of events){
  if(e.seq<=next)continue;
  next=e.seq;
  if(!baseline&&Number.isFinite(e.at)&&now-e.at<=2500&&e.at-now<=5000)fresh.push(e);
 }
 return {lastSeq:next,events:fresh};
}
