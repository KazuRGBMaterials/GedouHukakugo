import {makeRoomCode,normalizeRoomCode} from "../../cloud/identity.js";
import {lobby,prepareBattle,beginBattle,tickBattle,applyIntent,cleanIntent} from "./belt-engine.js?v=2";
export function createBeltRoom({connection,onState=()=>{},onMembers=()=>{},onStatus=()=>{}}){
 const {api,db,uid}=connection;
 let active=null;
 const ref=(code,part)=>api.ref(db,"beltRooms/"+code+"/"+part);
 const status=message=>onStatus(message);
 async function stage(label,fn){
  try{return await fn();}catch(e){
   const detail=String(e?.message||e),permission=/permission.denied|permission_denied|permission denied/i.test(detail+" "+(e?.code||""));
   throw Error(label+"："+detail+(permission?" ｜ Realtime Database の beltRooms ルールが公開済みか確認してください":""));
  }
 }
 const memberLabel=label=>String(label||"プレイヤー").trim().slice(0,16)||"プレイヤー";
 async function leave(){
  const old=active;active=null;
  if(!old)return;
  clearInterval(old.timer);old.unsubs.forEach(fn=>fn());
  try{await api.remove(ref(old.code,"members/"+uid));await api.onDisconnect(ref(old.code,"members/"+uid)).cancel();}catch{}
  status("退出しました");
 }
 function publish(s,strict=false){
  if(active!==s||!s.host)return Promise.resolve();
  const payload=JSON.stringify(s.state);
  if(payload.length>120000){status("同期データが大きすぎます");return Promise.resolve();}
  onState(s.state,s);
  const value={revision:s.state.revision,payload,updatedAt:api.serverTimestamp()};
  s.tail=s.tail.catch(()=>{}).then(()=>{
   if(active!==s)return;
   return api.set(ref(s.code,"state"),value);
  }).catch(e=>{if(strict)throw e;status("戦闘状態の送信エラー："+e.message);});
  return s.tail;
 }
 async function enter(code,meta,label,host){
  const s={code,meta,host,state:host?lobby(meta.mode):null,members:{},unsubs:[],timer:null,tail:Promise.resolve(),seen:new Set(),pending:new Map(),draining:false,drainAgain:false};
  const member=ref(code,"members/"+uid);
  // Deletion of an existing member is owner-authorized; register after creation.
  await stage("参加者登録（beltRooms/members）",()=>api.set(member,{label:memberLabel(label),joinedAt:api.serverTimestamp()}));
  try{await stage("切断時の退出予約（beltRooms/members）",()=>api.onDisconnect(member).remove());}catch(e){try{await api.remove(member);}catch{}throw e;}
  active=s;
  const error=e=>{if(active===s)status("同期エラー："+e.message);};
  s.unsubs.push(api.onValue(ref(code,"members"),snap=>{
   if(active!==s)return;s.members=snap.val()||{};onMembers(s.members,s);
   if(!s.members[meta.owner])status("ホストが接続していません。ホスト不在時は進行が止まります");
  },error));
  if(host){
   await stage('初期戦闘状態の登録（beltRooms/state）',()=>publish(s,true));
   async function drain(){
    if(s.draining){s.drainAgain=true;return;}
    s.draining=true;
    try{
     do{
      s.drainAgain=false;
      const pending=[...s.pending.values()].sort((a,b)=>a.id.localeCompare(b.id));
      const processed=[];
      for(const {sender,id,input} of pending){
       if(active!==s)return;
       const key=sender+"/"+id;
       if(s.seen.has(key)){processed.push(key);continue;}
       // Membership and assignment are authoritative on the host; every
       // message gets an explicit acknowledgement, including rejections.
       if(!s.members[sender]){const latest=await api.get(ref(code,"members"));s.members=latest.val()||{};}
       const accepted=!!s.members[sender]&&applyIntent(s.state,sender,input);
       s.state.acks??={};
       s.state.acks[sender]={id,accepted,message:accepted?"予約を受理しました":(s.state.feedback[sender]||"参加者登録が確認できません")};
       s.state.revision++;
       s.seen.add(key);processed.push(key);
      }
      if(processed.length){
       await publish(s,true); // Retain seen keys on failure: retries must never reserve twice.
       for(const key of processed){await api.remove(ref(code,"inputs/"+key));s.pending.delete(key);}
      }
     }while(s.drainAgain&&active===s);
    }catch(e){error(e);}
    finally{s.draining=false;}
   }
   s.unsubs.push(api.onValue(ref(code,"inputs"),snap=>{
    if(active!==s)return;
    const rows=snap.val()||{},next=new Map();
    for(const [sender,items] of Object.entries(rows))
     for(const [id,input] of Object.entries(items||{}))next.set(sender+"/"+id,{sender,id,input});
    for(const key of s.seen)if(!next.has(key))s.seen.delete(key);
    s.pending=next;void drain();
   },error));
   s.timer=setInterval(()=>{if(active!==s)return;if(s.pending.size)void drain();if(tickBattle(s.state))publish(s);},1600);
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
   // The 12-character random code is checked first. Rules allow metadata
   // creation only when absent, so even a rare concurrent collision is safe.
   const metaRef=ref(code,"meta");
   const existing=await stage("ルームコード確認（beltRooms/meta 読込）",()=>api.get(metaRef));
   if(existing.exists())continue;
   await stage("ルーム作成（beltRooms/meta 書込）",()=>api.set(metaRef,meta));
   return enter(code,meta,label,true);
  }
  throw Error("ルームを作成できません");
 }
 async function join(raw,label){
  const code=normalizeRoomCode(raw);
  if(!code)throw Error("招待コードは12文字です");
  await leave();
  const snap=await stage("ルーム確認（beltRooms/meta 読込）",()=>api.get(ref(code,"meta")));
  if(!snap.exists())throw Error("ルームが見つかりません");
  const meta=snap.val();if(!["coop","versus"].includes(meta.mode))throw Error("不正なルーム");
  if(meta.owner===uid)throw Error("ホストと同じ認証IDです。別端末または別ブラウザのプライベートウィンドウから参加してください");
  return enter(code,meta,label,false);
 }
 async function send(raw){
  const s=active;if(!s?.state)throw Error("未接続");
  const input=cleanIntent(raw);if(!input)throw Error("不正な入力");
  if(s.host){
   const accepted=applyIntent(s.state,uid,input);await publish(s,true);return {accepted,local:true};
  }
  const node=api.push(ref(s.code,"inputs/"+uid));
  await stage("ゲスト操作送信（beltRooms/inputs）",()=>api.set(node,{...input,at:api.serverTimestamp()}));
  return {id:node.key,local:false};
 }
 async function prepare(options){
  const s=active;if(!s?.host)throw Error("ホストのみ実行できます");
  const members=await stage("参加者一覧の確認",()=>api.get(ref(s.code,"members")));
  s.members=members.val()||{};
  if(prepareBattle(s.state,s.members,uid,options))await publish(s,true);
 }
 async function start(){
  const s=active;if(!s?.host)throw Error("ホストのみ実行できます");
  if(beginBattle(s.state))await publish(s);
 }
 return Object.freeze({create,join,leave,send,prepare,start,getSession:()=>active,getUid:()=>uid});
}
