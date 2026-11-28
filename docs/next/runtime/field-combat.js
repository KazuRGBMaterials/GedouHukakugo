/** Network-neutral FIELD sparring prototype. Only the receiver changes its own HP.
 * No Firebase or DOM dependencies; geometry matches the existing base skill speeds/ranges.
 */
const dirs={N:[0,-1],NE:[Math.SQRT1_2,-Math.SQRT1_2],E:[1,0],SE:[Math.SQRT1_2,Math.SQRT1_2],S:[0,1],SW:[-Math.SQRT1_2,Math.SQRT1_2],W:[-1,0],NW:[-Math.SQRT1_2,-Math.SQRT1_2]};
export const FIELD_DAMAGE=Object.freeze([10,12,5,15]);
export const LASER_DURATION=1.0, LASER_INTERVAL=.18, LASER_MAX_HITS=6, LASER_WIDTH_SCALE=2, LASER_RADIUS=6;
export const HIT_SOUND=Object.freeze(['hitFire','hitSlash','hitLaser','hitCharge']);
export const SLASH_KNOCKBACK=Object.freeze([38,48,66]);
export function fireDamage(radius=8){
 const r=Math.max(4.5,Math.min(22,Number(radius)||8));
 return Math.round(r<=8?6+(r-4.5)*4/3.5:10+(r-8)*20/14);
}
export function attackPacket(detail){
 const index=detail?.index;
 if(!Number.isInteger(index)||index<0||index>3||!Number.isFinite(detail.x)||!Number.isFinite(detail.y))return null;
 if(detail.x<0||detail.x>1600||detail.y<0||detail.y>1000)return null;
 const fallback=dirs[detail.facing]||dirs.S;
 let dx=Number.isFinite(detail.dx)?detail.dx:fallback[0],dy=Number.isFinite(detail.dy)?detail.dy:fallback[1];
 const length=Math.hypot(dx,dy);if(length<.01)return null;dx=Math.max(-1,Math.min(1,dx/length));dy=Math.max(-1,Math.min(1,dy/length));
 const radius=index===0?Math.max(4.5,Math.min(22,Number(detail.radius)||8)):index===1?15:index===2?LASER_RADIUS:15;
 const kind=index===1&&["dive","land"].includes(detail.kind)?detail.kind:"cast";
 return {index,x:detail.x,y:detail.y,dx,dy,radius,combo:Math.max(1,Math.min(3,Math.trunc(detail.combo)||1)),kind};
}
function blocked(x,y,r,world){
 return x-r<0||y-r<0||x+r>world.width||y+r>world.height||
  (world.obstacles||[]).some(o=>x+r>o.x&&x-r<o.x+o.w&&y+r>o.y&&y-r<o.y+o.h);
}
function distanceToLine(px,py,x,y,dx,dy,len){
 const t=Math.max(0,Math.min(len,(px-x)*dx+(py-y)*dy));
 return Math.hypot(px-x-t*dx,py-y-t*dy);
}
export class FieldCombat{
 constructor(onHp=()=>{},maxHp=100,{regenerate=false,onHit=()=>{}}={}){this.onHp=onHp;this.onHit=onHit;this.regenerate=regenerate;this.regenTimer=0;this.maxHp=Math.max(1,Number(maxHp)||100);this.hp=this.maxHp;this.enabled=false;this.effects=[];this.peerHp={};this.flash=0;this.peerHits=new Map();this.impacts=[];this.knockback=null;}
 enable(){if(!this.enabled){this.enabled=true;this.reset();}}
 disable(){this.enabled=false;this.effects=[];this.peerHp={};this.peerHits.clear();this.impacts=[];this.reset();}
 reset(){this.regenTimer=0;this.hp=this.maxHp;this.flash=0;this.knockback=null;this.effects=[];this.impacts=[];this.onHp(this.hp);}
 setPeerHp(values){
  for(const [id,hp] of Object.entries(values||{})){const old=this.peerHp[id];if(Number.isFinite(old)&&hp<old)this.peerHits.set(id,{damage:old-hp,life:.65});}
  this.peerHp=values||{};
 }
 receive(detail,{visualOnly=false,source='',seq=0}={}){
  if(!this.enabled)return false;
  const a=attackPacket(detail);if(!a)return false;
  if(this.effects.length>=120)this.effects.shift();
  const x=a.x+(a.kind==="cast"&&a.index!==3?a.dx*24:0),y=a.y+(a.kind==="cast"&&a.index!==3?a.dy*24:0);
  const life=a.kind==="dive"?.185:a.kind==="land"?.30:[1.25,.42,LASER_DURATION,.44][a.index];
  this.effects.push({...a,x,y,life,maxLife:life,hit:false,length:0,age:0,stopped:false,pulses:0,visualOnly,source,seq});
  return true;
 }
 damage(e,player){
  if(e.visualOnly||(e.hit&&e.index!==2)||!this.hp||e.kind==="dive")return;
  e.hit=true;
  const amount=e.index===0?fireDamage(e.radius):FIELD_DAMAGE[e.index],damage=Math.min(this.hp,amount);
  this.hp-=damage;this.regenTimer=0;this.flash=.45;this.impacts.push({x:player.x,y:player.y,life:.25,damage});this.onHp(this.hp);
  this.onHit({index:e.index,source:e.source||'',seq:e.seq||0,x:e.x,y:e.y,damage});
  if(e.index===1){
   let dx=e.dx,dy=e.dy;
   if(e.kind==="land"){const len=Math.hypot(player.x-e.x,player.y-e.y);if(len>1){dx=(player.x-e.x)/len;dy=(player.y-e.y)/len;}}
   this.knockback={dx,dy,remaining:SLASH_KNOCKBACK[e.combo-1],time:.18};
  }
 }
 tick(dt,world,player){
  dt=Math.max(0,Math.min(.05,Number(dt)||0));this.flash=Math.max(0,this.flash-dt);
  if(!this.enabled)return;
  for(const [id,hit] of this.peerHits){hit.life-=dt;if(hit.life<=0)this.peerHits.delete(id);}
  for(const impact of this.impacts)impact.life-=dt;this.impacts=this.impacts.filter(i=>i.life>0);
  const half=player.halfSize||15;
  for(const e of this.effects){
   if(e.life<=0)continue;
   e.age+=dt;
   if(e.stopped){e.life-=dt;continue;}
   if(e.kind==="land"){
    if(Math.hypot(e.x-player.x,e.y-player.y)<=35+half&&!blocked(e.x,e.y,1,world))this.damage(e,player);
   }else if(e.kind==="dive"){
    e.x+=e.dx*580*dt;e.y+=e.dy*580*dt;
   }else if(e.index===2){
    e.length=620;
    for(let d=0;d<e.length;d+=5)if(blocked(e.x+e.dx*d,e.y+e.dy*d,e.radius,world)){e.length=d;break;}
    // Pulses are tied to beam age, not rendering frame rate or snapshot count.
    while(e.pulses<LASER_MAX_HITS&&e.age+1e-9>=e.pulses*LASER_INTERVAL){
     e.pulses++;
     if(e.length>0&&distanceToLine(player.x,player.y,e.x,e.y,e.dx,e.dy,e.length)<=half+e.radius)this.damage(e,player);
    }
   }else{
    const distance=[560,390,0,950][e.index]*dt,steps=Math.max(1,Math.ceil(distance/5));
    for(let i=0;i<steps;i++){
     const x=e.x+e.dx*distance/steps,y=e.y+e.dy*distance/steps;
     if(blocked(x,y,e.radius,world)){e.stopped=true;e.life=.16;break;}
     e.x=x;e.y=y;
     if(!e.visualOnly&&Math.hypot(x-player.x,y-player.y)<=half+e.radius){
      this.damage(e,player);if(e.index===0){e.life=0;break;}if(e.index!==3){e.stopped=true;e.life=.18;break;}
     }
    }
   }
   e.life-=dt;
  }
  this.effects=this.effects.filter(e=>e.life>0);
  if(this.regenerate&&this.hp>0&&this.hp<this.maxHp){
   this.regenTimer+=dt;
   if(this.regenTimer>=1-1e-9){this.regenTimer=Math.max(0,this.regenTimer-1);this.hp=Math.min(this.maxHp,this.hp+1);this.onHp(this.hp);}
  }else this.regenTimer=0;
 }
 stopFire(source,seq){if(!seq)return;this.effects=this.effects.filter(e=>!(e.index===0&&e.source===source&&e.seq===seq));}
 applyKnockback(dt,world,player){
  const k=this.knockback;if(!k||!this.enabled||dt<=0)return false;
  const fraction=Math.min(1,dt/k.time),distance=k.remaining*fraction,steps=Math.max(1,Math.ceil(distance/4)),half=player.halfSize||15;
  const x0=player.x,y0=player.y;
  for(let i=0;i<steps;i++){const x=player.x+k.dx*distance/steps,y=player.y+k.dy*distance/steps;if(blocked(x,y,half,world))break;player.x=x;player.y=y;}
  player.moving=Math.hypot(player.x-x0,player.y-y0)>.001;
  k.remaining-=distance;k.time-=dt;
  if(k.time<=1e-6||!player.moving)this.knockback=null;
  return true;
 }
 draw(c,player,peers){
  if(!this.enabled||!c)return;
  c.save();
  for(const e of this.effects){
   c.save();c.globalAlpha=Math.min(1,e.life/.1);c.translate(e.x,e.y);c.rotate(Math.atan2(e.dy,e.dx));
   c.shadowBlur=10;c.shadowColor=e.index===0?"#ff9d36":"#b38aff";
   if(e.stopped){c.strokeStyle=e.index===0?"#ffcb6a":"#e9d3ff";c.lineWidth=3;c.beginPath();c.arc(0,0,e.radius+12*(1-e.life/.18),0,Math.PI*2);c.stroke();}
   else if(e.kind==="land"){c.strokeStyle="#e9d3ff";c.lineWidth=4;c.beginPath();c.arc(0,0,35,0,Math.PI*2);c.stroke();}
   else if(e.index===0){c.fillStyle="#ff9c35";c.beginPath();c.arc(0,0,e.radius,0,Math.PI*2);c.fill();c.fillStyle="#fff8c5";c.beginPath();c.arc(0,0,e.radius*.5,0,Math.PI*2);c.fill();}
   else if(e.index===2){c.strokeStyle="#c99bff";c.lineWidth=LASER_WIDTH_SCALE*(12+4*Math.sin(e.age*35)**2);c.beginPath();c.moveTo(0,0);c.lineTo(e.length,0);c.stroke();c.strokeStyle="#fff";c.lineWidth=3*LASER_WIDTH_SCALE;c.stroke();}
   else if(e.index===1){c.strokeStyle="#e9d3ff";c.lineWidth=6;c.beginPath();c.arc(0,0,26,-1.08,1.08);c.stroke();}
   else{c.strokeStyle="#c69cff";c.lineWidth=7;c.beginPath();c.moveTo(-35,0);c.lineTo(12,0);c.stroke();}
   c.restore();
  }
  for(const p of peers?.values?.()||[]){const hp=this.peerHp[p.id];if(!Number.isFinite(hp))continue;
   const y=p.drawY-(p.height||0);c.fillStyle="#321b28";c.fillRect(p.drawX-18,y-49,36,4);c.fillStyle="#75e9a4";c.fillRect(p.drawX-18,y-49,36*hp/100,4);
   const hit=this.peerHits.get(p.id);if(hit){c.save();c.strokeStyle="#ff6868";c.lineWidth=3;c.beginPath();c.arc(p.drawX,y,20,0,Math.PI*2);c.stroke();c.font='bold 15px system-ui';c.textAlign='center';c.fillStyle='#ffb0a5';c.fillText('-'+hit.damage,p.drawX,y-58-(.65-hit.life)*18);c.restore();}
  }
  for(const hit of this.impacts){c.save();c.globalAlpha=Math.min(1,hit.life*4);c.strokeStyle='#ffc5a2';c.lineWidth=3;c.beginPath();c.arc(hit.x,hit.y,15+(.25-hit.life)*60,0,Math.PI*2);c.stroke();c.font='bold 15px system-ui';c.fillStyle='#ffb0a5';c.textAlign='center';c.fillText('-'+hit.damage,hit.x,hit.y-42);c.restore();}
  if(this.flash>0){c.strokeStyle="#ff6868";c.lineWidth=3;c.globalAlpha=Math.min(1,this.flash*4);c.beginPath();c.arc(player.x,player.y,23,0,Math.PI*2);c.stroke();}
  c.restore();
 }
}

/** One swept projectile, one nearest living target. Wall collision takes priority. */
export function stepEnemyFire(e,dt,world,targets){
 const distance=560*dt,steps=Math.max(1,Math.ceil(distance/5));
 for(let i=0;i<steps;i++){
  const x=e.x+e.dx*distance/steps,y=e.y+e.dy*distance/steps;
  if(blocked(x,y,e.radius,world)){e.life=0;return null;}
  e.x=x;e.y=y;
  const hit=targets.filter(p=>p.hp>0&&Math.hypot(x-p.x,y-p.y)<=p.halfSize+e.radius).sort((a,b)=>Math.hypot(x-a.x,y-a.y)-Math.hypot(x-b.x,y-b.y))[0];
  if(hit){e.life=0;return hit;}
 }
 e.life-=dt;return null;
}
