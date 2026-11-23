import { distance, adjacent8, fireReaches } from "./grid-rules.js?v=7";

// Bounded deterministic two-ply planning. Uses only revealed positions and queued
// actions, obeys the same command, range, stamina and timing rules as everyone else.
// No peek at unrevealed future player input and no boss-only damage/HP bonuses.
const CARDINAL = [[1,0],[-1,0],[0,1],[0,-1]];
const ADV = { yellow:"blue", blue:"red", red:"yellow" };
const ATTACKS = new Set(["quick","heavy","fire","jumpSlash"]);
const eq = (a,b) => a && b && a.x===b.x && a.y===b.y;
const byId = (a,b) => a.id.localeCompare(b.id);

const actionAt = (unit,tick) => (unit.actions||[]).find(a =>
  a.status==="pending" && a.start<=tick && tick<=a.end);
const projected = (unit,tick,nowTick) => {
  let pos = unit.at;
  for(const a of unit.actions||[]){
    if(a.status!=="pending"||a.impact<=nowTick||a.impact>=tick)continue;
    if(a.commandId==="move" && a.destination)pos=a.destination;
    if(a.commandId==="jumpSlash"&&a.landing)pos=a.landing;
  }
  return pos;
};
const occupied = (cell,units,except) => units.some(u =>
  u.id!==except && u.hp>0 && eq(u.at,cell));

function isInRange(cmd,from,to,board){
  if(!from||!to)return false;
  if(cmd==="fire")return fireReaches(from,to,board);
  if(cmd==="jumpSlash")return distance(from,to)>=1 && distance(from,to)<=4;
  return adjacent8(from,to);
}

function damageMultiplier(attack,other){
  if(!attack.color||!other?.color)return 1;
  if(ADV[attack.color]===other.color)return 1.5;
  if(ADV[other.color]===attack.color)return .7;
  return 1;
}
function winsClash(a,b){
  if(!a?.color || !b?.color)return false;
  return a.color===b.color ? a.level>=b.level+2 : ADV[a.color]===b.color && a.level>=b.level;
}

// Predict confirmed moves. A foe can still change an attack target at the
// warning slot; discount distant hits rather than treating predictions as truth.
function damageToTarget(cmd,at,from,target,view){
  const {commands,board,nowTick,side,comrades,opponents}=view;
  const targetPos=projected(target,at,nowTick);
  if(!isInRange(cmd,from,targetPos,board))return 0;
  if(cmd==="jumpSlash"){
    const spaces=CARDINAL.concat([[1,1],[1,-1],[-1,1],[-1,-1]])
      .map(([dx,dy])=>({x:targetPos.x+dx,y:targetPos.y+dy}));
    const units=[...comrades,...opponents];
    const possible=spaces.some(c=>c.x>=0&&c.y>=0&&c.x<board.columns&&c.y<board.rows
      && !eq(c,from) && !occupied(c,units,side)
      && Math.max(Math.abs(c.x-from.x),Math.abs(c.y-from.y))<=3);
    if(!possible)return 0;
  }
  const status=actionAt(target,at);
  const targetCmd=commands[status?.commandId];
  if(status?.commandId==="dodge" && status.impact===at)return 0;
  const clash=ATTACKS.has(status?.commandId)&&status.impact===at&&
    (status.commandId==="fire" || status.targetSide===side) &&
    isInRange(status.commandId,targetPos,from,board);
  if(clash && winsClash(targetCmd,commands[cmd]))return 0;
  const multiplier=clash && winsClash(commands[cmd],targetCmd)?2:
    damageMultiplier(commands[cmd],targetCmd);
  const guard = status?.commandId === "guard" ? .45 : 1;
  const hit=commands[cmd].damage * multiplier * guard;
  const uncertainty=at<=nowTick+2?1:at<=nowTick+4?.9:.78;
  // Avoid dumping 80+ damage into a target that comrades are already finishing.
  const assisting=comrades.filter(c=>c.id!==side).reduce((sum,c)=>
    sum+(c.actions||[]).filter(a=>a.status==="pending"&&a.targetSide===target.id
      && ATTACKS.has(a.commandId) && Math.abs(a.impact-at)<=2)
      .reduce((n,a)=>n+(commands[a.commandId]?.damage||0)*.6,0),0);
  const useful=Math.min(hit,Math.max(0,target.hp-assisting));
  const kill=hit>=target.hp-assisting && target.hp>0 ? 16 : 0;
  return (useful + kill) * uncertainty;
}

function threatCost(command,at,from,after,view){
  const {commands,opponents,board,nowTick,side}=view;
  const end=at+command.tc-1;
  let total=0;
  for(const enemy of opponents){
    const ordered=(enemy.actions||[]).filter(a=>a.status==="pending"&&ATTACKS.has(a.commandId)
      && a.impact>=at && a.impact<=end);
    for(const a of ordered){
      const step=a.impact,enemyPos=projected(enemy,step,nowTick);
      // Movement resolves after attacks in its own impact tick.
      const ourPos=command.id==="move" && step>at ? after : from;
      if(a.commandId!=="fire" && a.targetSide && a.targetSide!==side)continue;
      if(!isInRange(a.commandId,enemyPos,ourPos,board))continue;
      const aCmd=commands[a.commandId]; if(!aCmd)continue;
      if(command.id==="dodge" && at+commands.dodge.impact-1===step)continue;
      const ourImpact=at+commands[command.id]?.impact-1;
      if(ATTACKS.has(command.id) && step===ourImpact &&
          isInRange(command.id,from,enemyPos,board) && winsClash(commands[command.id],aCmd))continue;
      let multiplier=damageMultiplier(aCmd,commands[command.id]);
      if(ATTACKS.has(command.id) && step===ourImpact &&
          winsClash(aCmd,commands[command.id]))multiplier=2;
      const guard=command.id==="guard"?.45:1;
      const dmg=aCmd.damage*multiplier*guard;
      total += dmg * (step<=nowTick+3?1:.85);
    }
  }
  const nearby=opponents.filter(o=>o.hp>0 && adjacent8(after,o.at)).length;
  // Give unsafe wind-ups a small penalty even when the player has not queued
  // their next move yet. Never pretend to know that future move.
  const exposure=command.id==="heavy"||command.id==="fire"||command.id==="jump"
    ? 1.8 : .5;
  return total + Math.max(0,nearby-1)*exposure;
}

function scoreCandidate(candidate,view,fromOverride=null,startOverride=null,staminaOverride=null){
  const {commands,opponents,comrades,board,nowTick,side}=view;
  const from=fromOverride??view.from, start=startOverride??view.nextStart;
  const available=staminaOverride??view.stamina;
  const cmd=commands[candidate.id];
  if(!cmd || cmd.sc>available+.001)return -Infinity;
  const impact=start+cmd.impact-1;
  const targets=opponents.filter(o=>o.hp>0).sort(byId);
  const chosen=targets.find(o=>o.id===candidate.target);
  const targetPos=chosen?projected(chosen,impact,nowTick):null;
  let after=from, damage=0, utility=0;
  if(candidate.id==="move"){
    const d=candidate.destination;
    if(!d || distance(from,d)!==1||d.x<0||d.y<0||d.x>=board.columns||d.y>=board.rows
      ||occupied(d,[...opponents,...comrades],side))return -Infinity;
    after=d;
    const nearest=p=>Math.min(...targets.map(t=>distance(p,t.at)));
    const gain=nearest(from)-nearest(d);
    const threats=targets.reduce((s,t)=>s+(adjacent8(d,t.at)?1:0),0);
    utility=6.5*gain + (threats===1?1.4:0);
    if(gain<=0)utility-=4;
  }else if(ATTACKS.has(candidate.id)){
    if(candidate.id==="fire"){
      damage=targets.reduce((s,t)=>s+damageToTarget("fire",impact,from,t,view),0);
    }else if(chosen){
      damage=damageToTarget(candidate.id,impact,from,chosen,view);
      if(candidate.id==="jumpSlash"&&damage>0 && targetPos){
        const units=[...opponents,...comrades];
        const options=CARDINAL.concat([[1,1],[1,-1],[-1,1],[-1,-1]])
          .map(([dx,dy])=>({x:targetPos.x+dx,y:targetPos.y+dy}))
          .filter(c=>c.x>=0&&c.y>=0&&c.x<board.columns&&c.y<board.rows
            && !eq(c,from)&&!occupied(c,units,side)
            && Math.max(Math.abs(c.x-from.x),Math.abs(c.y-from.y))<=3);
        if(options.length) {
          after=options.sort((a,b)=>distance(a,from)-distance(b,from))[0];
          utility+=3;
        }
      }
    }
  }else if(candidate.id==="guard"){
    utility=2;
  }else if(candidate.id==="dodge"){
    utility=1;
  }else if(candidate.id==="wait"){
    utility=available<=3?5:available<=6?2:-2;
  }else if(candidate.id==="jump"){
    const tgt=chosen;
    if(!tgt || !isInRange("jumpSlash",from,tgt.at,board)
      || !tgt.landingAvailable)return -Infinity;
    utility=2;
  }

  const risk=threatCost({id:candidate.id,tc:cmd.tc},start,from,after,view);
  const healthPressure=view.hp<=30?1.4:view.hp<=60?1.15:1;
  const tempo=cmd.tc*.95;
  const cost=cmd.sc*1.05 * (available<=4?1.4:1);
  const attackPayoff=damage*(candidate.id==="fire"?1:1.1);
  let score=attackPayoff+utility-risk*healthPressure-tempo-cost;
  if(candidate.id==="guard" && risk<2) score-=9;
  if(candidate.id==="dodge" && risk<2)score-=10;
  if(candidate.id==="wait" && risk>5)score-=4;
  if(candidate.id==="jump" && risk>4)score-=risk*.65;
  return score;
}

function candidateActions(view,canChoose){
  const options=[];
  const alive=view.opponents.filter(o=>o.hp>0).sort(byId);
  for(const target of alive){
    for(const id of ["quick","heavy","jump","jumpSlash"]){
      if(id==="jumpSlash"&&view.previous!=="jump")continue;
      if(canChoose(id))options.push({id,target:target.id});
    }
  }
  if(canChoose("fire"))options.push({id:"fire"});
  for(const id of ["guard","dodge","wait"])if(canChoose(id))options.push({id});
  for(const [dx,dy] of CARDINAL){
    const d={x:view.from.x+dx,y:view.from.y+dy};
    if(canChoose("move",d))options.push({id:"move",destination:d});
  }
  return options;
}

function nextPotential(first,view) {
  const cmd=view.commands[first.id];
  const available=Math.min(12,view.stamina-cmd.sc + (first.id==="wait"||first.id==="guard"?1:0));
  const start=view.nextStart + cmd.tc;
  const followView={...view,nextStart:start,stamina:available,previous:first.id};
  const positions=first.id==="move"?first.destination:view.from;
  const targets=view.opponents.filter(o=>o.hp>0);
  const candidates=[];
  if(first.id==="jump"){
    for(const target of targets)if(available>=view.commands.jumpSlash.sc &&
      distance(positions,target.at)<=4&&target.landingAvailable)
      candidates.push({id:"jumpSlash",target:target.id});
  }else {
    for(const target of targets)for(const id of ["quick","heavy"])
      if(available>=view.commands[id].sc)candidates.push({id,target:target.id});
    if(available>=view.commands.fire.sc)candidates.push({id:"fire"});
    if(available>=view.commands.wait.sc)candidates.push({id:"wait"});
  }
  let best=-10;
  for(const c of candidates){
    const v=scoreCandidate(c,followView,positions,start,available);
    if(v>best)best=v;
  }
  return best;
}

export function chooseOptimalEnemyAction(view,canChoose){
  const {commands,opponents}=view;
  if(!commands||!opponents.some(o=>o.hp>0))return null;
  // Against a confirmed immediate jab, a one-slot guard is better than
  // committing to a slow wind-up before the hit has resolved.
  // Limit this duel counter to 1v1; in a group, AoE/crossfire may be superior.
  const urgent=opponents.some(o=>(o.actions||[]).some(a=>a.status==="pending"
    && a.commandId==="quick" && a.impact===view.nextStart
    && (!a.targetSide || a.targetSide===view.side)
    && adjacent8(view.from,o.at)));
  if(view.comrades.length===1 && urgent && canChoose("guard"))return {id:"guard"};
  const candidates=candidateActions(view,canChoose);
  if(!candidates.length)return null;
  let winner=candidates[0],best=-Infinity;
  // Max ~25 legal first choices and ~9 second-choice evaluations each;
  // bounded per decision for small phones, 4v4 and large boards.
  for(const candidate of candidates){
    const first=scoreCandidate(candidate,view);
    if(!Number.isFinite(first))continue;
    const second=nextPotential(candidate,view);
    // Approximated second ply is discounted: the player may change commands.
    const value=first + .46*second;
    if(value>best+1e-6){best=value;winner=candidate}
  }
  return winner;
}
