import {makeRoomCode,normalizeRoomCode} from "../../cloud/identity.js";
import {lobby,prepareBattle,beginBattle,tickBattle,applyIntent,cleanIntent} from "./belt-engine.js?v=1";
export function createBeltRoom({connection,onState=()=>{},onMembers=()=>{},onStatus=()=>{}}){
 const {api,db,uid}=connection;
 let active=null;
 const ref=(code,part)=>api.ref(db,"beltRooms/"+code+"/"+part);
 const status=message=>onStatus(message);
 const memberLabel=label=>String(label||"プレイヤー").trim().slice(0,16)||"プレイヤー";
 async function leave(){
  const old=active;active=null;
  if(!old)return;
  clearInterval(old.timer);old.unsubs.forEach(fn=>fn());
  try{await api.remove(ref(old.code,"members/"+uid));await api.onDisconnect(ref(old.code,"members/"+uid)).cancel();}catch{}
  status("退出しました");
 }
 function publish(s){
  if(active!==s||!s.host)return Promise.resolve();
  const payload=JSON.stringify(s.state);
  if(payload.length>120000){status("同期データが大きすぎます");return Promise.resolve();}
  onState(s.state,s);
  const value={revision:s.state.revision,payload,updatedAt:api.serverTimestamp()};
  s.tail=s.tail.catch(()=>{}).then(()=>{
   if(active!==s)return;
   return api.set(ref(s.code,"state"),value);
  }).catch(e=>status("戦闘状態の送信エラー："+e.message));
  return s.tail;
 }
 async function enter(code,meta,label,host){
  const s={code,meta,host,state:host?lobby(meta.mode):null,members:{},unsubs:[],timer:null,tail:Promise.resolve(),seen:new Set()};
  const member=ref(code,"members/"+uid);
  // Deletion of an existing member is owner-authorized; register after creation.
  await api.set(member,{label:memberLabel(label),joinedAt:api.serverTimestamp()});
  try{await api.onDisconnect(member).remove();}catch(e){try{await api.remove(member);}catch{}throw e;}
  active=s;
  const error=e=>{if(active===s)status("同期エラー："+e.message);};
  s.unsubs.push(api.onValue(ref(code,"members"),snap=>{
   if(active!==s)return;s.members=snap.val()||{};onMembers(s.members,s);
   if(!s.members[meta.owner])status("ホストが接続していません。ホスト不在時は進行が止まります");
  },error));
  if(host){
   await publish(s);
   s.unsubs.push(api.onValue(ref(code,"inputs"),snap=>{
    if(active!==s)return;
    const rows=snap.val()||{},pending=[];
    for(const [sender,items] of Object.entries(rows))
     for(const [id,input] of Object.entries(items||{}))pending.push({sender,id,input});
    pending.sort((a,b)=>a.id.localeCompare(b.id));
    let changed=false;
    for(const {sender,id,input} of pending){
     const key=sender+"/"+id;
     if(!s.seen.has(key)){
      s.seen.add(key);
      if(s.members[sender]){
       const before=s.state.revision;applyIntent(s.state,sender,input);changed||=s.state.revision!==before;
      }
     }
     api.remove(ref(code,"inputs/"+key)).then(()=>s.seen.delete(key)).catch(error);
    }
    if(changed)publish(s);
   },error));
   s.timer=setInterval(()=>{if(active===s&&tickBattle(s.state))publish(s);},1600);
  }else{
   s.unsubs.push(api.onValue(ref(code,"state"),snap=>{
    if(active!==s)return;
    const data=snap.val();if(!data||typeof data.payload!=="string")return;
    try{
     const next=JSON.parse(data.payload);
     if(next.schemaVersion!==1||next.mode!==meta.mode||!Number.isSafeInteger(next.revision)||next.revision<(s.state?.revision??-1))return;
     s.state=next;onState(next,s);
    }catch{status("戦闘状態を読み込めません");}
   },error));
  }
  status("ROOM "+code+" · "+(host?"ホスト":"参加者")+" · "+(meta.mode==="coop"?"協力":"対戦"));
  return code;
 }
 async function create(mode,label){
  if(!["coop","versus"].includes(mode))throw Error("不正なモード");
  await leave();
  for(let i=0;i<5;i++){
   const code=makeRoomCode(),meta={owner:uid,mode,createdAt:api.serverTimestamp()};
   const tx=await api.runTransaction(ref(code,"meta"),old=>old==null?meta:undefined,{applyLocally:false});
   if(tx.committed)return enter(code,meta,label,true);
  }
  throw Error("ルームを作成できません");
 }
 async function join(raw,label){
  const code=normalizeRoomCode(raw);
  if(!code)throw Error("招待コードは12文字です");
  await leave();
  const snap=await api.get(ref(code,"meta"));
  if(!snap.exists())throw Error("ルームが見つかりません");
  const meta=snap.val();if(!["coop","versus"].includes(meta.mode))throw Error("不正なルーム");
  return enter(code,meta,label,false);
 }
 async function send(raw){
  const s=active;if(!s?.state)throw Error("未接続");
  const input=cleanIntent(raw);if(!input)throw Error("不正な入力");
  if(s.host){
   applyIntent(s.state,uid,input);await publish(s);return;
  }
  const node=api.push(ref(s.code,"inputs/"+uid));
  await api.set(node,{...input,at:api.serverTimestamp()});
 }
 async function prepare(options){
  const s=active;if(!s?.host)throw Error("ホストのみ実行できます");
  if(prepareBattle(s.state,s.members,uid,options))await publish(s);
 }
 async function start(){
  const s=active;if(!s?.host)throw Error("ホストのみ実行できます");
  if(beginBattle(s.state))await publish(s);
 }
 return Object.freeze({create,join,leave,send,prepare,start,getSession:()=>active,getUid:()=>uid});
}
