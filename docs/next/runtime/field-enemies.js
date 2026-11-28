/** Local FIELD enemies. No DOM, database, or renderer dependencies in the AI. */
import {FieldCombat,attackPacket} from "./field-combat.js?v=7";
export const LASER_CHARGE_SECONDS=1.5;
export const ENEMY_SPAWNS=Object.freeze([
 {id:"slash1",type:"slash",label:"近接型",x:1220,y:140,hp:55,halfSize:15,speed:165},
 {id:"slash2",type:"slash",label:"近接型",x:1450,y:220,hp:55,halfSize:15,speed:165},
 {id:"fire1",type:"fire",label:"射撃型",x:1320,y:345,hp:45,halfSize:15,speed:125},
 {id:"fire2",type:"fire",label:"射撃型",x:1530,y:100,hp:45,halfSize:15,speed:125},
 {id:"hellor",type:"boss",label:"ヘルオル",x:1400,y:830,hp:400,halfSize:42,speed:205}
].map(Object.freeze));
const facing=(dx,dy)=>["E","SE","S","SW","W","NW","N","NE"][(Math.round(Math.atan2(dy,dx)/(Math.PI/4))+8)%8];
const safe=(x,y,r,w)=>x-r>=0&&y-r>=0&&x+r<=w.width&&y+r<=w.height&&!(w.obstacles||[]).some(o=>x+r>o.x&&x-r<o.x+o.w&&y+r>o.y&&y-r<o.y+o.h);
function lineClear(a,b,w,r=5){
 const dx=b.x-a.x,dy=b.y-a.y,n=Math.max(1,Math.ceil(Math.hypot(dx,dy)/8));
 for(let i=0;i<=n;i++)if(!safe(a.x+dx*i/n,a.y+dy*i/n,r,w))return false;
 return true;
}
function move(e,dx,dy,speed,dt,w){
 const len=Math.hypot(dx,dy);if(len<.01)return false;
 const d=speed*dt,n=Math.max(1,Math.ceil(d/4)),sx=dx/len*d/n,sy=dy/len*d/n;
 const x=e.x,y=e.y;
 for(let i=0;i<n;i++){
  if(safe(e.x+sx,e.y,e.halfSize,w))e.x+=sx;
  if(safe(e.x,e.y+sy,e.halfSize,w))e.y+=sy;
 }
 e.moving=Math.hypot(e.x-x,e.y-y)>.01;return e.moving;
}
export class FieldEnemies{
 constructor({sendAttack=()=>{},onDefeat=()=>{},spawns=ENEMY_SPAWNS}={}){
  this.sendAttack=sendAttack;this.onDefeat=onDefeat;this.spawns=spawns;this.active=true;this.reset();
 }
 reset(){
  this.enemies=this.spawns.map(s=>{
   const e={...s,homeX:s.x,homeY:s.y,facing:"W",moving:false,aggro:false,cooldown:.35,windup:null,combo:0,nextSkill:0,dash:null,pose:null};
   e.combat=new FieldCombat((hp)=>{e.hp=hp;if(hp===0){e.windup=null;e.dash=null;e.moving=false;this.onDefeat(e);}},s.hp);
   e.combat.enable();return e;
  });
 }
 // Restore the last committed encounter, not a fresh spawn. Missing IDs stay defeated.
 restore(rows){
  if(!Array.isArray(rows))return false;
  const mirror=enemyMirror(rows);
  if(mirror.enemies.length!==rows.length)return false;
  this.reset();
  const byId=new Map(mirror.enemies.map(e=>[e.id,e]));
  this.enemies=this.enemies.filter(e=>byId.has(e.id));
  for(const e of this.enemies){
   const s=byId.get(e.id),raw=rows.find(r=>r.id===e.id);
   Object.assign(e,{x:s.x,y:s.y,hp:s.hp,facing:s.facing,moving:false,windup:s.windup?structuredClone(s.windup):null,aggro:!!raw.aggro,cooldown:Math.max(0,Math.min(3,Number(raw.cooldown)||0)),combo:Math.max(0,Math.min(3,Math.trunc(raw.combo)||0)),nextSkill:Math.max(0,Math.trunc(raw.nextSkill)||0)});
   e.combat.hp=s.hp;
  }
  return true;
 }
 setActive(value){this.active=!!value;if(!this.active)for(const e of this.enemies){e.windup=null;e.dash=null;e.combat.effects=[];}}
 receive(detail){
  if(!this.active||!attackPacket(detail))return false;
  for(const e of this.enemies)if(e.hp>0)e.combat.receive(detail);
  return true;
 }
 cast(e,index,aim,combo=1){
  const len=Math.hypot(aim.x-e.x,aim.y-e.y)||1,dx=(aim.x-e.x)/len,dy=(aim.y-e.y)/len;
  // Large boss casts from its leading edge, not inside its own sprite.
  const offset=Math.max(0,e.halfSize-15);
  const packet={index,x:e.x+dx*offset,y:e.y+dy*offset,dx,dy,facing:facing(dx,dy),combo,kind:"cast",radius:index===0?(e.type==="boss"?22:8):undefined};
  e.facing=packet.facing;e.pose={index,life:index===2?1:.35};this.sendAttack(packet,e);
  if(index===3)e.dash={dx,dy,life:.36};
 }
 plan(e,index,player){
  const duration=index===2?LASER_CHARGE_SECONDS:index===0?(e.type==="boss"?1.4:.4):index===3?.28:.16;
  e.windup={index,elapsed:0,duration,aim:{x:player.x,y:player.y}};e.moving=false;
 }
 tick(dt,world,player,playerHp){return this.tickParty(dt,world,[{...player,hp:playerHp}]);}
 tickParty(dt,world,party){
  if(!this.active)return;
  const alive=party.filter(p=>p.hp>0&&Number.isFinite(p.x)&&Number.isFinite(p.y));
  dt=Math.max(0,Math.min(.05,Number(dt)||0));
  for(const e of this.enemies){
   if(e.hp<=0)continue;
   e.combat.tick(dt,world,e);
   if(e.hp<=0)continue;
   if(e.pose){e.pose.life-=dt;if(e.pose.life<=0)e.pose=null;}
   if(e.combat.applyKnockback(dt,world,e)){e.windup=null;e.dash=null;continue;}
   e.moving=false;e.cooldown=Math.max(0,e.cooldown-dt);
   const player=alive.reduce((best,p)=>!best||Math.hypot(p.x-e.x,p.y-e.y)<Math.hypot(best.x-e.x,best.y-e.y)?p:best,null);
   if(!player){e.windup=null;e.dash=null;continue;}
   const dx=player.x-e.x,dy=player.y-e.y,d=Math.hypot(dx,dy),boss=e.type==="boss";
   const aggro=boss?520:340,leash=boss?530:420;
   if(d<aggro)e.aggro=true;
   if(Math.hypot(e.x-e.homeX,e.y-e.homeY)>leash||d>aggro+220){e.aggro=false;e.windup=null;e.dash=null;}
   if(!e.aggro){
    const hx=e.homeX-e.x,hy=e.homeY-e.y;if(Math.hypot(hx,hy)>8){e.facing=facing(hx,hy);move(e,hx,hy,e.speed*.65,dt,world);}continue;
   }
   if(e.dash){const v=e.dash;move(e,v.dx,v.dy,780,dt,world);v.life-=dt;if(v.life<=0)e.dash=null;continue;}
   if(e.windup){
    const w=e.windup;w.elapsed+=dt;
    // Track until the final 0.25 seconds; players can dodge the committed shot.
    if(w.duration-w.elapsed>.25)w.aim={x:player.x,y:player.y};
    e.facing=facing(w.aim.x-e.x,w.aim.y-e.y);
    if(w.elapsed+1e-9>=w.duration){
     e.windup=null;const combo=w.index===1?(boss?(e.combo%3)+1:1):1;if(w.index===1)e.combo=combo;
     this.cast(e,w.index,w.aim,combo);if(boss&&w.index===1&&combo===3)e.nextSkill++;e.cooldown=w.index===2?1.05:w.index===3?.75:w.index===0?(boss?.55:1.35):boss?(combo===3?.5:.28):.85;
    }continue;
   }
   if(e.pose?.index===2)continue;
   e.facing=facing(dx,dy);
   const clear=lineClear(e,player,world),near=e.halfSize+52;
   if(e.cooldown<=0&&clear){
    if(e.type==="slash"&&d<=near){this.plan(e,1,player);continue;}
    if(e.type==="fire"&&d<=410){this.plan(e,0,player);continue;}
    if(boss){
     // Cycle all four skills; move into range when necessary rather than firing through walls.
     const cycle=[1,0,2,3],index=cycle[e.nextSkill%cycle.length],range=[560,near,620,390][index];
     if(d<=range){if(index!==1)e.nextSkill++;this.plan(e,index,player);continue;}
     if(index===1&&d>near+130&&d<=560){this.plan(e,0,player);continue;}
    }
   }
   const desired=e.type==="fire"?245:near*.8;
   if(e.type==="fire"&&d<130&&clear){move(e,-dx,-dy,e.speed,dt,world);continue;}
   if(d>desired||!clear){
    if(!move(e,dx,dy,e.speed,dt,world)){
     const side=e.id.endsWith("2")?-1:1;
     if(!move(e,-dy*side,dx*side,e.speed,dt,world))move(e,dy*side,-dx*side,e.speed,dt,world);
    }
   }
  }
  this.enemies=this.enemies.filter(e=>e.hp>0);
 }
}
/** Snapshot only visual fields. Guests do not execute AI or enemy HP simulation. */
export function enemySnapshot(system){
 return system.enemies.filter(e=>e.hp>0).map(e=>({id:e.id,x:Math.round(e.x*10)/10,y:Math.round(e.y*10)/10,hp:e.hp,facing:e.facing,moving:!!e.moving,windup:e.windup?structuredClone(e.windup):null,flash:e.combat.flash>0,aggro:e.aggro,cooldown:e.cooldown,combo:e.combo,nextSkill:e.nextSkill}));
}
export function enemyMirror(rows){
 const list=Array.isArray(rows)?rows:[],enemies=[];
 for(const def of ENEMY_SPAWNS){
  const r=list.find(x=>x?.id===def.id);
  if(!r||!Number.isFinite(r.x)||!Number.isFinite(r.y)||!Number.isInteger(r.hp)||r.hp<=0||r.hp>def.hp||r.x<0||r.x>1600||r.y<0||r.y>1000)continue;
  const w=r.windup,windup=w&&Number.isInteger(w.index)&&w.index>=0&&w.index<=3&&Number.isFinite(w.elapsed)&&Number.isFinite(w.duration)&&w.duration>0&&Number.isFinite(w.aim?.x)&&Number.isFinite(w.aim?.y)?w:null;
  enemies.push({...def,x:r.x,y:r.y,hp:r.hp,facing:["N","NE","E","SE","S","SW","W","NW"].includes(r.facing)?r.facing:"S",moving:!!r.moving,windup,combat:{maxHp:def.hp,flash:r.flash?.5:0,impacts:[]}});
 }
 return {active:true,enemies};
}
/** Uses existing graphics via injected drawing port; fallback visible during loading. */
export function drawFieldEnemies(ctx,system,drawSprite,elapsed=0){
 if(!system.active||!ctx)return;
 for(const e of system.enemies){
  if(e.hp<=0)continue;
  const boss=e.type==="boss",size=boss?3.2:1.05,hit=e.combat.flash>0;
  ctx.save();ctx.fillStyle="#09071388";ctx.beginPath();ctx.ellipse(e.x,e.y+10,15*size,5*size,0,0,Math.PI*2);ctx.fill();
  if(!drawSprite(ctx,e,size,elapsed)){
   ctx.fillStyle=boss?"#56263e":"#473658";ctx.fillRect(e.x-14*size,e.y-30*size,28*size,39*size);
   ctx.fillStyle="#ff725c";ctx.fillRect(e.x-5*size,e.y-20*size,10*size,4*size);
  }
  if(hit){ctx.strokeStyle="#ff806e";ctx.lineWidth=2;ctx.beginPath();ctx.arc(e.x,e.y,20*size,0,Math.PI*2);ctx.stroke();}
  const width=boss?126:44,y=e.y-40*size;
  ctx.fillStyle="#34232e";ctx.fillRect(e.x-width/2,y,width,6);ctx.fillStyle=boss?"#e34a5b":"#e4a056";ctx.fillRect(e.x-width/2,y,width*e.hp/e.combat.maxHp,6);
  ctx.font=boss?"bold 17px system-ui":"11px system-ui";ctx.textAlign="center";ctx.fillStyle="#fff0dc";ctx.fillText(e.label+" "+e.hp+"/"+e.combat.maxHp,e.x,y-5);
  if(e.windup){const w=e.windup,p=Math.min(1,w.elapsed/w.duration),dx=w.aim.x-e.x,dy=w.aim.y-e.y,angle=Math.atan2(dy,dx),x=e.x+Math.cos(angle)*(e.halfSize+13),yy=e.y-14+Math.sin(angle)*(e.halfSize+13);
   ctx.strokeStyle=w.index===0?"#ffbc55":w.index===1?"#f9dcde":"#d4a3ff";ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,yy,8+18*p,0,Math.PI*2);ctx.stroke();
   ctx.fillStyle="#fff5df";ctx.beginPath();ctx.arc(x,yy,3+5*p,0,Math.PI*2);ctx.fill();
   ctx.fillStyle="#c99cff";ctx.fillRect(e.x-width/2,y+9,width*p,3);
  }
  for(const hit of e.combat.impacts){ctx.fillStyle="#ffd2a4";ctx.font="bold 16px system-ui";ctx.fillText("-"+hit.damage,e.x,y-21-(.25-hit.life)*25);}
  ctx.restore();
 }
}
