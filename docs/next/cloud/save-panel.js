/**
 * Independent save UI injected at the composition edge.
 * Local play remains default. No network until player clicks cloud enable.
 */
import {createFirebaseGateway} from "./firebase-service.js";
import {createCloudSaveStore,SaveConflictError} from "./save-store.js";
export function mountCloudSavePanel({container,slot,port,gateway=createFirebaseGateway(),onMessage=()=>{}}) {
 if(!container||!port?.capture||!port?.restore)throw new Error("Save UI requires a game state port");
 const section=document.createElement("section");
 section.className="gedo-cloud-save";
 section.innerHTML=`<details>
 <summary>☁ クラウド保存・端末引継ぎ</summary>
 <p class="cloud-hint">初期設定はローカル専用です。利用を有効にするとFirebase匿名IDと、このブラウザ専用のランダムIDを使います。端末情報・IP・機種名は収集しません。</p>
 <p class="cloud-hint">ゲスト保存はブラウザのデータ削除や端末変更で復旧不能になることがあります。別端末への移行はJSON書き出しで可能です。</p>
 <div class="cloud-buttons">
 <button type="button" data-cloud="connect">クラウド利用を有効にする</button>
 <button type="button" data-cloud="save" disabled>☁ 保存</button>
 <button type="button" data-cloud="load" disabled>☁ 読込</button>
 <button type="button" data-cloud="delete" disabled>☁ 削除</button>
 <button type="button" data-cloud="export">JSON書出し</button>
 <button type="button" data-cloud="import">JSON取込み</button>
 </div>
 <label class="cloud-hint"><input type="checkbox" data-cloud="autosave" disabled> 30秒ごとに変更を自動保存（任意）</label>
 <input type="file" data-cloud="file" accept="application/json,.json" hidden>
 <p class="cloud-status" data-cloud="status" role="status" aria-live="polite">この端末だけに保存中</p>
 </details>`;
 container.append(section);
 const pick=name=>section.querySelector('[data-cloud="'+name+'"]');
 const status=pick("status"),buttons=["save","load","delete","autosave"].map(pick);
 const stableState=data=>JSON.stringify(data,(key,value)=>key==="savedAt"?undefined:value);
 let store=null,revision=null,remoteExists=false,hasReviewed=false,
   lastPayload=null,pending=false;
 const inform=(msg)=>{status.textContent=msg;onMessage(msg)};
 function enable(active){for(const b of buttons)b.disabled=!active;}
 async function exclusive(fn) {
  if(pending)return;
  pending=true;
  try{await fn();}catch(error){
   inform((error instanceof SaveConflictError?"保存競合：":"エラー：")+(error?.message||error));
   if(error instanceof SaveConflictError){revision=null;hasReviewed=false;remoteExists=true;pick("autosave").checked=false;}
  }finally{pending=false;}
 }
 function snapshot(){
  const data=port.capture();
  if(data==null||typeof data!=="object")throw new Error("現在のゲーム状態を保存できません");
  return data;
 }
 async function refresh(){
  const record=await store.load(slot);
  revision=record?.revision ?? null;
  remoteExists=!!record;
  hasReviewed=!record;
  inform(record?"クラウドにセーブがあります。内容を読込むか、上書きを確認してください":"クラウド側の保存は空です。保存できます");
  return record;
 }
 pick("connect").disabled=!gateway.configured;
 if(!gateway.configured)inform("Firebase未設定：クラウド機能は無効です。ローカルのセーブは利用できます");
 pick("connect").addEventListener("click",()=>exclusive(async()=>{
  inform("Firebaseへ接続中…");
  const connection=await gateway.connect();
  store=createCloudSaveStore(connection);
  await refresh();
  enable(true);
  pick("connect").disabled=true;
  pick("connect").textContent="☁ 接続済み";
  inform((remoteExists?"保存データあり":"新規セーブ可能")+" · 匿名UID "+connection.uid.slice(0,8)+"… · 端末ID "+connection.deviceId.slice(0,6)+"…");
 }));
 async function save(auto=false){
  if(!store)return;
  if(remoteExists&&!hasReviewed){
   if(auto)return;
   if(!confirm("クラウド側の既存セーブを上書きします。内容を確認していない場合は先に『読込』してください。続けますか？"))return;
  }
  const data=snapshot(),json=JSON.stringify(data);
  const currentState=stableState(data);
  if(auto&&lastPayload===currentState)return;
  // If network fails, do not report 'saved'. Transactions detect concurrent devices.
  const next=await store.save(slot,data,revision);
  revision=next.revision;
  hasReviewed=true;
  remoteExists=true;
  lastPayload=currentState;
  inform("☁ クラウド保存済み · revision "+revision+"（"+new Date().toLocaleTimeString("ja-JP")+"）");
 }
 pick("save").addEventListener("click",()=>exclusive(()=>save()));
 pick("load").addEventListener("click",()=>exclusive(async()=>{
  if(!store)return;
  const record=await refresh();
  if(!record){inform("クラウド側にセーブがありません");return;}
  if(!confirm("クラウドの保存状態で現在の状態を置き換えます。ローカルの未保存内容は失われる場合があります。よろしいですか？"))return;
  const result=port.restore(record.data);
  if(result===false)throw new Error("現在のマップや形式と一致せず復元できません");
  revision=record.revision;
  lastPayload=stableState(snapshot());
  hasReviewed=true;
  inform("☁ セーブを読み込みました · revision "+revision);
 }));
 pick("delete").addEventListener("click",()=>exclusive(async()=>{
  if(!store)return;
  const record=await refresh();
  if(!record){inform("削除対象のクラウドセーブがありません");return;}
  if(!confirm("クラウド側のセーブを削除します。端末内のセーブは残ります。削除しますか？"))return;
  await store.remove(slot,revision);
  revision=null;remoteExists=false;hasReviewed=true;lastPayload=null;
  inform("クラウドセーブだけを削除しました。端末内のデータは維持しています");
 }));
 pick("autosave").addEventListener("change",()=>{
  if(pick("autosave").checked && !hasReviewed){
   pick("autosave").checked=false;
   inform("自動保存の前に、クラウドデータを読み込むか保存して競合を確認してください");
  }
 });
 const timer=setInterval(()=>{
  if(!store||!pick("autosave").checked||pending||!hasReviewed)return;
  exclusive(()=>save(true));
 },30000);
 const download=()=>{
  const data=snapshot();
  const out=JSON.stringify({schema:"gedo-cloud-backup",version:1,slot,data},null,2);
  const url=URL.createObjectURL(new Blob([out],{type:"application/json"}));
  const a=document.createElement("a");
  a.href=url;a.download="gedo-"+slot+"-"+new Date().toISOString().slice(0,10)+".json";
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  inform("JSONバックアップを書き出しました（クラウド送信なし）");
 };
 pick("export").addEventListener("click",()=>exclusive(async()=>download()));
 pick("import").addEventListener("click",()=>pick("file").click());
 pick("file").addEventListener("change",()=>exclusive(async()=>{
  const file=pick("file").files?.[0];pick("file").value="";
  if(!file)return;
  if(file.size>2100000)throw new Error("2.1MBを超えるバックアップは読み込めません");
  const archive=JSON.parse(await file.text());
  if(archive?.schema!=="gedo-cloud-backup"||archive.version!==1||archive.slot!==slot)
   throw new Error("別種類または不正なバックアップです");
  if(!confirm("JSONのデータで現在の状態を置き換えます。続けますか？"))return;
  if(port.restore(archive.data)===false)throw new Error("現在のマップや形式では読み込めません");
  inform("JSONを読み込みました。クラウドへは未送信です");
  hasReviewed=!remoteExists;lastPayload=null;
 }));
 return Object.freeze({element:section,destroy(){clearInterval(timer);section.remove();}});
}
