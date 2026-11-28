"use strict";
/* GEDO STUDIO alpha: unified record registry, deliberate AI draft acceptance,
 * canonical field editor bridge. Offline-first and zero write access to GitHub. */
const KEY="gedo-studio-project-v1";
const MAP_KEY="gedo-field-editor-autosave-v1";
const FORMAT="gedo-studio/v1";
const MODULES={
 scenes:{title:"シナリオ",subtitle:"SCENARIO EDITOR",icon:"✎",help:"場面・台詞・分岐を記録し、登場人物やマップ、BGMとつなぎます。",data:{chapter:"灼道",scene:"",dialogue:[],conditions:[]}},
 characters:{title:"キャラクター",subtitle:"CHARACTER EDITOR",icon:"♜",help:"人物像と画像・アニメーションの対応を記録します。",data:{role:"",description:"",visualId:"",animationIds:[]}},
 images:{title:"画像",subtitle:"ART ASSETS",icon:"◈",help:"AI生成画像・ドット絵などの素材ID・ファイルパス・使用条件を管理します。",data:{kind:"sprite",path:"",directionCount:8,notes:""}},
 animations:{title:"アニメ",subtitle:"ANIMATION CLIPS",icon:"♧",help:"動作・フレーム列とキャラ／画像の関連を記録します。",data:{actorId:"",frames:[0,1,2],fps:10,loop:true}},
 maps:{title:"マップ",subtitle:"MAP LIBRARY",icon:"▦",help:"既存のフィールドエディターとJSONを明示的に受け渡します。",data:{schema:"gedo-field-map",version:1}},
 music:{title:"音楽",subtitle:"MUSIC LIBRARY",icon:"♫",help:"曲案とBGMファイルの参照、ループ点、シーンとの対応を記録します。",data:{file:"",mood:"",bpm:null,loopStart:null,loopEnd:null}},
 effects:{title:"エフェクト",subtitle:"VFX LIBRARY",icon:"✦",help:"スキルなどの演出を、画像とアニメーションの参照で管理します。",data:{skill:"",animationId:"",visualId:"",durationMs:250}}
};
const root={};
for(const id of ["sections","module-subtitle","module-title","module-help","record-count","record-list","record-form","none","record-id","saved-status","name","state","description","payload","links","link-target","link-add","metrics","draft-json","toast","add-record","copy-prompt","import-draft","export-project","import-open","import-file","pull-map","push-map","duplicate","delete"]){
 root[id]=document.getElementById(id);
 if(!root[id])throw new Error("Missing studio UI "+id);
}
const make=(tag,text,className)=>{
 const el=document.createElement(tag);
 if(text!==undefined)el.textContent=text;
 if(className)el.className=className;
 return el;
};
const uid=()=> "asset-"+(crypto.randomUUID?.()||Math.random().toString(36).slice(2));
const safeText=(val,max=8000)=>String(val??"").slice(0,max);
function emptyProject(){
 const records={};for(const k of Object.keys(MODULES))records[k]=[];
 return {schema:FORMAT,version:1,title:"外道不覚悟",records};
}
function validateProject(v){
 if(!v||v.schema!==FORMAT||v.version!==1||!v.records||typeof v.records!=="object")throw Error("gedo-studio/v1形式のプロジェクトJSONが必要です");
 const out=emptyProject(),seen=new Set();
 out.title=safeText(v.title||"外道不覚悟",100);
 for(const module of Object.keys(MODULES)){
  const raw=v.records[module];
  if(!Array.isArray(raw)||raw.length>500)throw Error("不正な記録配列："+module);
  for(const entry of raw){
   if(!entry||typeof entry!=="object"||typeof entry.id!=="string"||
      !/^[a-zA-Z0-9_-]{3,100}$/.test(entry.id)||seen.has(entry.id))
    throw Error("記録IDに重複・不正があります");
   if(!["draft","review","approved"].includes(entry.status))throw Error("状態が不正です");
   if(!entry.data||typeof entry.data!=="object"||Array.isArray(entry.data))throw Error("dataが不正です");
   if(!Array.isArray(entry.links)||entry.links.length>100||!entry.links.every(x=>typeof x==="string"&&/^[a-zA-Z0-9_-]{3,100}$/.test(x)))throw Error("関連データが不正です");
   seen.add(entry.id);
   out.records[module].push({
    id:entry.id,title:safeText(entry.title,100)||"名称未設定",status:entry.status,
    description:safeText(entry.description),data:JSON.parse(JSON.stringify(entry.data)),
    links:[...new Set(entry.links)],updatedAt:safeText(entry.updatedAt,40)
   });
  }
 }
 const all=new Set(seen);
 for(const module of Object.keys(MODULES))for(const row of out.records[module])
  row.links=row.links.filter(link=>all.has(link)&&link!==row.id);
 return out;
}
function storageGet(key){try{return localStorage.getItem(key)}catch{return null}}
function storageSet(key,data){localStorage.setItem(key,data)}
let project=emptyProject();
try{const json=storageGet(KEY);if(json)project=validateProject(JSON.parse(json))}catch(e){console.warn("Studio storage fallback",e)}
let active="scenes",selection=null,notificationTimer=null;
function announce(message){
 root.toast.textContent=message;root.toast.classList.add("show");
 clearTimeout(notificationTimer);notificationTimer=setTimeout(()=>root.toast.classList.remove("show"),3000);
}
function persist(){
 try{storageSet(KEY,JSON.stringify(project))}catch(e){announce("ブラウザ保存に失敗。JSONを保存してください");return false;}
 renderMetrics();return true;
}
function allEntries(){
 const list=[];for(const [k,v] of Object.entries(project.records))for(const rec of v)list.push({...rec,module:k});
 return list;
}
function selected(){return project.records[active].find(r=>r.id===selection)||null}
function renderSections(){
 root.sections.replaceChildren();
 for(const [id,info] of Object.entries(MODULES)){
  const button=make("button",info.icon+"  "+info.title);
  button.type="button";button.className=id===active?"active":"";
  const number=make("small",String(project.records[id].length));button.append(number);
  button.addEventListener("click",()=>{active=id;selection=null;render();});
  root.sections.append(button);
 }
}
function renderMetrics(){
 const all=allEntries(),approved=all.filter(r=>r.status==="approved").length;
 root.metrics.textContent=all.length+" records / "+approved+" approved / "+(all.length-approved)+" unapproved";
}
function renderList(){
 root["module-title"].textContent=MODULES[active].title;
 root["module-subtitle"].textContent=MODULES[active].subtitle;
 root["module-help"].textContent=MODULES[active].help;
 root["record-count"].textContent=project.records[active].length;
 root["record-list"].replaceChildren();
 for(const record of project.records[active]){
  const item=make("button");item.type="button";item.className="record"+(record.id===selection?" selected":"");
  item.append(make("strong",record.title));
  item.append(make("small",(record.status==="approved"?"承認済み":record.status==="review"?"手修正中":"AIドラフト")+" · "+record.id.slice(0,21)));
  item.addEventListener("click",()=>{selection=record.id;renderList();renderForm();});
  root["record-list"].append(item);
 }
}
function renderLinks(record){
 const all=allEntries().filter(e=>e.id!==record.id);
 root.links.replaceChildren();
 for(const link of record.links){
  const other=all.find(e=>e.id===link);
  const line=make("div",other?MODULES[other.module].title+"： "+other.title:link,"link-item");
  const remove=make("button","×");remove.type="button";remove.title="関連付けを解除";
  remove.addEventListener("click",()=>{record.links=record.links.filter(x=>x!==link);persist();renderForm();});
  line.append(remove);root.links.append(line);
 }
 root["link-target"].replaceChildren();
 const none=make("option","関連付ける素材を選択");none.value="";root["link-target"].append(none);
 for(const other of all.filter(e=>!record.links.includes(e.id))){
  const opt=make("option",MODULES[other.module].title+"： "+other.title);opt.value=other.id;root["link-target"].append(opt);
 }
}
function renderForm(){
 const record=selected();
 root.none.hidden=!!record;root["record-form"].hidden=!record;
 if(!record)return;
 root["record-id"].textContent=record.id;
 root["saved-status"].textContent=record.status==="approved"?"採用承認済":record.status==="review"?"手修正中":"AIドラフト";
 root.name.value=record.title;root.state.value=record.status;
 root.description.value=record.description;
 root.payload.value=JSON.stringify(record.data,null,2);
 renderLinks(record);
}
function render(){renderSections();renderList();renderForm();renderMetrics()}
function newRecord(module,title,data={},description=""){
 const row={id:uid(),title:safeText(title,100)||"無題",status:"draft",description:safeText(description),
   data:JSON.parse(JSON.stringify(data)),links:[],updatedAt:new Date().toISOString()};
 project.records[module].push(row);active=module;selection=row.id;persist();render();return row;
}
root["add-record"].addEventListener("click",()=>{
 newRecord(active,"新規"+MODULES[active].title,JSON.parse(JSON.stringify(MODULES[active].data)));
 announce("新規ドラフトを作成しました");
});
root["record-form"].addEventListener("submit",event=>{
 event.preventDefault();
 const row=selected();if(!row)return;
 let obj;try{obj=JSON.parse(root.payload.value)}catch(e){announce("JSONの構文エラー："+e.message);return;}
 if(!obj||typeof obj!=="object"||Array.isArray(obj)){announce("編集データはJSONオブジェクトで入力してください");return;}
 const name=root.name.value.trim();if(!name){announce("名称を入力してください");return;}
 row.title=safeText(name,100);row.status=root.state.value;
 row.description=safeText(root.description.value);row.data=obj;row.updatedAt=new Date().toISOString();
 persist();render();announce(row.status==="approved"?"人が承認済みとして保存しました":"編集内容を保存しました");
});
root["link-add"].addEventListener("click",()=>{
 const row=selected(),id=root["link-target"].value;
 if(!row||!id||row.links.includes(id)||id===row.id||!allEntries().some(e=>e.id===id))return;
 row.links.push(id);persist();renderForm();
});
root.duplicate.addEventListener("click",()=>{
 const row=selected();if(!row)return;
 const clone=newRecord(active,row.title+"（コピー）",row.data,row.description);
 clone.links=[...row.links];persist();render();announce("コピーは未承認ドラフトとして作成しました");
});
root.delete.addEventListener("click",()=>{
 const row=selected();if(!row||!confirm("「"+row.title+"」を削除しますか？"))return;
 project.records[active]=project.records[active].filter(r=>r.id!==row.id);
 for(const other of allEntries()){
  const target=project.records[other.module].find(x=>x.id===other.id);
  if(target)target.links=target.links.filter(x=>x!==row.id);
 }
 selection=null;persist();render();announce("削除しました");
});
function downloadJSON(name,text){
 const blob=new Blob([text],{type:"application/json;charset=utf-8"});
 const url=URL.createObjectURL(blob);
 const a=make("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),800);
}
root["export-project"].addEventListener("click",()=>{
 if(!persist())return;
 downloadJSON("GEDO_STUDIO_project_v1.json",JSON.stringify(project,null,2)+"\n");
 announce("プロジェクトJSONを書き出しました");
});
root["import-open"].addEventListener("click",()=>root["import-file"].click());
root["import-file"].addEventListener("change",async()=>{
 const file=root["import-file"].files?.[0];if(!file)return;
 if(file.size>3_000_000){announce("読み込めるJSONは3MBまでです");return;}
 try{
  const imported=validateProject(JSON.parse(await file.text()));
  if(!confirm("現在のプロジェクトを読み込んだ内容に置き換えますか？ 必要なら先にJSON保存してください。"))return;
  project=imported;selection=null;active="scenes";persist();render();announce("プロジェクトJSONを読み込みました");
 }catch(e){announce("読込失敗："+e.message)}
 finally{root["import-file"].value=""}
});
function aiPrompt(){
 return "『外道不覚悟』の制作AIとして、既存のシナリオ・キャラ造形・設計履歴との矛盾を避けて【"+MODULES[active].title+"】のドラフトを1件作成してください。"+
 "作り物の確定設定は増やさず、未確定箇所は notes に明示してください。出力は説明文なしのJSONオブジェクトで、"+
 "module は "+Object.keys(MODULES).join("/")+" のいずれか、title、description、data を含めてください。"+
 "例：{\"module\":\""+active+"\",\"title\":\"ドラフト名\",\"description\":\"目的\",\"data\":{}}。"+
 "AI出力は未承認のドラフトとして読み込み、最終判断・修正・採用は人が行います。";
}
root["copy-prompt"].addEventListener("click",async()=>{
 try{await navigator.clipboard.writeText(aiPrompt());announce("AIへの依頼テンプレートをコピーしました");}
 catch{announce("コピーできません。HTTPS接続・ブラウザ権限を確認してください")}
});
root["import-draft"].addEventListener("click",()=>{
 const content=root["draft-json"].value.trim();
 if(!content||content.length>350000){announce("ドラフトは35万文字以内のJSONにしてください");return;}
 try{
  const incoming=JSON.parse(content);
  const data=Array.isArray(incoming)?incoming:[incoming];
  if(data.length>50)throw Error("一度に50件まで");
  const prepared=data.map(item=>{
   if(!item||!MODULES[item.module]||!item.data||typeof item.data!=="object"||Array.isArray(item.data))throw Error("module/title/description/dataを確認してください");
   return {module:item.module,title:safeText(item.title,100)||"AIドラフト",description:safeText(item.description),data:item.data};
  });
  for(const item of prepared)newRecord(item.module,item.title,item.data,item.description);
  root["draft-json"].value="";announce(prepared.length+"件のAIドラフトを未承認で取り込みました");
 }catch(e){announce("AIドラフトJSONを読み込めません："+e.message)}
});
function validateMap(map){
 if(!map||map.schema!=="gedo-field-map"||map.version!==1||!Array.isArray(map.objects)||!Array.isArray(map.paths)||
  !Number.isFinite(map.width)||!Number.isFinite(map.height)||map.width<400||map.height<300)throw Error("フィールドエディターのマップJSON形式ではありません");
 if(map.objects.length>600||map.paths.length>120)throw Error("マップが大きすぎます");
 return map;
}
root["pull-map"].addEventListener("click",()=>{
 try{
  const raw=storageGet(MAP_KEY);if(!raw)throw Error("エディターの保存データがありません");
  const map=validateMap(JSON.parse(raw));
  const row=newRecord("maps",safeText(map.name,90)||"フィールド",map,"フィールドエディターから取り込んだドラフト");
  row.status="review";persist();render();announce("マップの現在の保存版を工房へ取り込みました");
 }catch(e){announce("マップ取込失敗："+e.message)}
});
root["push-map"].addEventListener("click",()=>{
 const row=selected();if(active!=="maps"||!row){announce("先に「マップ」から送信する項目を選んでください");return;}
 try{
  validateMap(row.data);
  if(!confirm("フィールドエディターの現在の自動保存を上書きします。続けますか？"))return;
  storageSet(MAP_KEY,JSON.stringify(row.data));
  announce("エディターへマップを渡しました");
  window.open("../editor/","_blank","noopener");
 }catch(e){announce("マップ送信に失敗："+e.message)}
});
window.addEventListener("storage",event=>{if(event.key===KEY)announce("別タブで制作記録が変更されました。再読込して同期してください");});
render();