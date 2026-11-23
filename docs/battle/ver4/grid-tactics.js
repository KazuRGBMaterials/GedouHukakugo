import { distance, adjacent8, fireReaches, rangeStep } from "./grid-rules.js?v=7";

// Strategy layer for the enemy team. It only issues existing, legal commands.
// In particular, "protect" redirects a hit only when the front defender is guarding.
export const ENEMY_TACTICS = Object.freeze({
  standard: "従来のAI",
  isolate: "各個撃破重視",
  focus: "集団集中攻撃",
  ruthless: "卑劣漢",
  bait: "仲間を囮にする",
  protect: "敵を引き受け仲間を庇う"
});
const cardinal = [[1,0],[-1,0],[0,1],[0,-1]];
const offensive = new Set(["quick","heavy","jumpSlash","fire"]);
const live = list => list.filter(unit => unit.hp > 0);
const upcoming = (unit, at) => unit.actions?.find(action =>
  action.status === "pending" && action.start <= at && action.end >= at);
const aboutToAttack = (unit, at) => unit.actions?.some(action =>
  action.status === "pending" && offensive.has(action.commandId)
  && action.impact >= at && action.impact <= at + 1);
const attacking = (unit, side, at) => unit.actions?.some(action =>
  action.status === "pending" && offensive.has(action.commandId)
  && action.commandId !== "fire" && action.targetSide === side
  && action.impact >= at && action.impact <= at + 2);
const byId = (a,b) => a.id.localeCompare(b.id);
const choose = (options, rank) => [...options].sort((a,b) => rank(b)-rank(a) || byId(a,b))[0];
const exposed = (unit, at) => {
  const action = upcoming(unit,at);
  return ["heavy","fire","jump","jumpSlash","wait"].includes(action?.commandId);
};

function reachMove(from, to, canChoose, board, away = false) {
  const cell = rangeStep(from,to,away ? 1 : -1,
    destination => canChoose("move",destination),board);
  if (cell) return {id:"move",destination:cell};
  const alternatives = cardinal.map(([dx,dy])=>({x:from.x+dx,y:from.y+dy}))
    .filter(destination=>canChoose("move",destination))
    .sort((a,b) => (away ? distance(b,to)-distance(a,to) : distance(a,to)-distance(b,to))
      || a.y-b.y || a.x-b.x);
  return alternatives.length ? {id:"move",destination:alternatives[0]} : null;
}

function pressure(view, target, canChoose, {preferQuick=false,flank=false,allowFire=true}={}) {
  const {from,board,previous,stamina,nextStart,opponents} = view;
  if (previous === "jump" && canChoose("jumpSlash"))
    return {id:"jumpSlash",target:target.id};
  const close = adjacent8(from,target.at);
  const fireGroup = live(opponents).filter(unit => fireReaches(from,unit.at,board)).length;
  if (allowFire && fireGroup >= 2 && canChoose("fire"))
    return {id:"fire",target:target.id};
  if (close) {
    const vulnerable = exposed(target,nextStart);
    const first = preferQuick || vulnerable ? "quick" : "heavy";
    if (canChoose(first))return {id:first,target:target.id};
    if (canChoose(first==="quick"?"heavy":"quick"))
      return {id:first==="quick"?"heavy":"quick",target:target.id};
  }
  if (!close && fireReaches(from,target.at,board) && allowFire
      && (!flank || distance(from,target.at)>=3) && canChoose("fire"))
    return {id:"fire",target:target.id};
  if (!close && distance(from,target.at)>=2 && distance(from,target.at)<=4
      && target.landingAvailable && stamina>=4 && canChoose("jump"))
    return {id:"jump",target:target.id};
  const move=reachMove(from,target.at,canChoose,board);
  if (move)return {...move,target:target.id};
  if (canChoose("wait"))return {id:"wait",target:target.id};
  return null;
}

export function chooseEnemyTactic(view,canChoose) {
  const {tactic,side,from,opponents,comrades,board,turn,nextStart,previous,stamina} = view;
  const targets=live(opponents);
  const friends=live(comrades).sort(byId);
  if (!targets.length || tactic==="standard" || !ENEMY_TACTICS[tactic])return null;

  // Each fighter seeks a vulnerable/isolated kill in reach; targets need not match.
  if (tactic==="isolate") {
    const target=choose(targets,o=>(100-o.hp)*.9-distance(from,o.at)*10+
      (adjacent8(from,o.at)?18:0) + (exposed(o,nextStart)?13:0));
    return pressure(view,target,canChoose,{preferQuick:exposed(target,nextStart),allowFire:false});
  }

  // Entire team converges on one victim; prefer matching the allies' impact slot.
  if (tactic==="focus") {
    const target=choose(targets,o=>(100-o.hp)*1.1 -
      friends.reduce((sum,friend)=>sum+distance(friend.at,o.at),0)*4);
    if (previous==="jump"&&canChoose("jumpSlash"))return {id:"jumpSlash",target:target.id};
    if (adjacent8(from,target.at)) {
      const otherImpacts=friends.filter(friend=>friend.id!==side).flatMap(friend=>
        (friend.actions||[]).filter(a=>a.status==="pending"&&a.targetSide===target.id
          && offensive.has(a.commandId)).map(a=>a.impact));
      const nextQuick=nextStart, nextHeavy=nextStart+2;
      if(otherImpacts.length){
        const nearest=step=>Math.min(...otherImpacts.map(i=>Math.abs(i-step)));
        if(nearest(nextHeavy)<nearest(nextQuick)&&canChoose("heavy"))
          return {id:"heavy",target:target.id};
      }
      if(canChoose("quick"))return {id:"quick",target:target.id};
    }
    return pressure(view,target,canChoose,{preferQuick:true});
  }

  // Cowardly opportunist: hit exposed or wounded opponents, avoid fair exchanges.
  if (tactic==="ruthless") {
    const target=choose(targets,o=>(100-o.hp)*1.2-distance(from,o.at)*7+
      (exposed(o,nextStart)?24:0)+(o.stamina<=2?12:0));
    if (previous==="jump"&&canChoose("jumpSlash"))return {id:"jumpSlash",target:target.id};
    const threatened=targets.some(o=>aboutToAttack(o,nextStart));
    if (threatened && !exposed(target,nextStart) && canChoose("guard") && turn%3!==0)
      return {id:"guard",target:target.id};
    if (adjacent8(from,target.at)&&exposed(target,nextStart)&&canChoose("quick"))
      return {id:"quick",target:target.id};
    if (adjacent8(from,target.at)&&target.hp>45&&stamina<4) {
      const retreat=reachMove(from,target.at,canChoose,board,true);
      if(retreat)return {...retreat,target:target.id};
    }
    return pressure(view,target,canChoose,{preferQuick:true,flank:true,allowFire:false});
  }

  // Leader draws attention; accomplices punish players committed to attacking him.
  if (tactic==="bait") {
    if (friends.length===1) {
      const target=choose(targets,o=>(100-o.hp)-distance(from,o.at)*8);
      return pressure(view,target,canChoose,{preferQuick:true});
    }
    const bait=friends[0];
    const baited=targets.filter(o=>attacking(o,bait.id,nextStart));
    const target=choose(baited.length?baited:targets,o=>(100-o.hp)*.8-
      distance(from,o.at)*9+(exposed(o,nextStart)?15:0));
    if (side===bait.id) {
      if (previous==="jump"&&canChoose("jumpSlash"))return {id:"jumpSlash",target:target.id};
      if (adjacent8(from,target.at)) {
        if(canChoose("guard")&&(baited.length||turn%3!==2))return {id:"guard",target:target.id};
        if(canChoose("quick"))return {id:"quick",target:target.id};
      }
      const advance=reachMove(from,target.at,canChoose,board);
      if(advance)return {...advance,target:target.id};
      return canChoose("guard")?{id:"guard",target:target.id}:null;
    }
    return pressure(view,target,canChoose,{preferQuick:exposed(target,nextStart)});
  }

  // A frontline defender stays by the weakest comrade, and actively guards
  // incoming single-target attacks so the combat engine can intercept one hit.
  if (tactic==="protect") {
    if (friends.length===1) {
      const target=choose(targets,o=>(100-o.hp)-distance(from,o.at)*8);
      return pressure(view,target,canChoose);
    }
    const defender=friends[0];
    const atRisk=choose(friends.filter(o=>o.id!==defender.id),
      o=>(100-o.hp)*1.1 + targets.filter(t=>attacking(t,o.id,nextStart)).length*45);
    const target=choose(targets,o=>(100-o.hp)*.7-distance(from,o.at)*9);
    if (side===defender.id && atRisk) {
      if (previous==="jump"&&canChoose("jumpSlash"))return {id:"jumpSlash",target:target.id};
      const nearby=adjacent8(from,atRisk.at);
      if (!nearby) {
        const toFriend=reachMove(from,atRisk.at,canChoose,board);
        if(toFriend)return {...toFriend,target:target.id};
      }
      if (nearby && targets.some(t=>attacking(t,atRisk.id,nextStart))
          && canChoose("guard"))return {id:"guard",target:target.id};
      // Hold a visible guard when a nearby protected ally faces melee pressure,
      // even before the player commits an attack. This keeps "cover" observable.
      if (nearby && targets.some(t=>distance(t.at,atRisk.at)<=2)
          && turn%3===0 && canChoose("guard"))return {id:"guard",target:target.id};
    }
    return pressure(view,target,canChoose,{preferQuick:side!==defender.id});
  }
  return null;
}
