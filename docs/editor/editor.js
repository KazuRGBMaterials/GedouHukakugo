import {SCHEMA_VERSION,STORAGE_KEY,DEFAULT_SIZE,ALLOWED_TYPES,defaultMap,deepCopy,validateMap,collides,nearestSafeSpawn,newId} from "./map-schema.js";

const $=id=>document.getElementById(id);
const canvas=$("map-canvas"),holder=$("canvas-holder"),ctx=canvas.getContext("2d");
if(!ctx)throw Error("Canvas 2D not available");
const labels={wall:"石壁",tree:"樹木",water:"水辺",chest:"宝箱",path:"道",spawn:"開始位置"};
const colors={wall:"#778781",tree:"#5f925f",water:"#39899c",chest:"#c89a5c"};
let map,tool="select",selection=null,drag=null,drawDraft=null,pathDraft=null;
let grid=true,snap=true,gridSize=32,zoom=.6,offsetX=0,offsetY=0,playing=false,player=null;
let past=[],future=[],dirty=false,noticeTimer=0,lastTime=0;
const keys=new Set(),touchDirections=new Set(),images={};
const assetNames={ground:"ground.svg",path:"path.svg",stone:"stone.svg",water:"water.svg",tree:"tree.svg",chest:"chest.svg",mage:"mage-8dir.png"};
for(const [key,file] of Object.entries(assetNames)){
 const image=new Image();image.src="../assets/"+file;image.onload=()=>render();images[key]=image;
}
const asset=key=>images[key]?.complete&&images[key].naturalWidth?images[key]:null;
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const round=n=>Math.round(n);
const snapNum=n=>snap?Math.round(n/gridSize)*gridSize:Math.round(n);
function announce(message){$("status-message").textContent=message;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{$("status-message").textContent=playing?"矢印キー / WASD / 画面パッドで移動":"ツールを選んで編集してください"},3600);}
function readLocal(){try{const s=localStorage.getItem(STORAGE_KEY);if(s){const validated=validateMap(JSON.parse(s));return validated;}}catch(e){console.warn("Invalid saved editor map",e)}return defaultMap();}
function persist(quiet=false){
 try{localStorage.setItem(STORAGE_KEY,JSON.stringify(map));$("last-saved").textContent="自動保存済み・この端末";dirty=false;$("dirty-mark").textContent="";if(!quiet)announce("この端末に保存しました");}
 catch(e){$("last-saved").textContent="保存できませんでした";$("dirty-mark").textContent="● 未保存";if(!quiet)announce("保存できません。JSONとして書き出してください");}
}
function refreshInfo(){
 $("map-caption").textContent=map.name;$("map-name").value=map.name;
 $("map-width").value=map.width;$("map-height").value=map.height;
 $("object-count").textContent=map.objects.length+" 個・道 "+map.paths.length+" 本";
 $("zoom-value").textContent=Math.round(zoom*100)+"%";
 $("undo").disabled=past.length===0;$("redo").disabled=future.length===0;
 refreshInspector();
}
function commit(before,{message=""}={}){
 if(JSON.stringify(before)===JSON.stringify(map)){render();return false;}
 past.push(before);if(past.length>70)past.shift();
 future=[];dirty=true;
 persist(true);refreshInfo();render();if(message)announce(message);
 return true;
}
function mutate(fn,message){if(playing)return;const before=deepCopy(map);fn();map=validateMap(map);commit(before,{message});}
function undo(){
 if(!past.length||playing)return;
 future.push(deepCopy(map));map=past.pop();selection=null;pathDraft=null;
 persist(true);refreshInfo();render();announce("ひとつ前の状態に戻しました");
}
function redo(){
 if(!future.length||playing)return;
 past.push(deepCopy(map));map=future.pop();selection=null;pathDraft=null;
 persist(true);refreshInfo();render();announce("やり直しました");
}
function getSelected(){
 if(!selection)return null;
 return selection.kind==="object"?map.objects.find(o=>o.id===selection.id):map.paths.find(p=>p.id===selection.id);
}
function refreshInspector(){
 const sel=getSelected(),object=!!sel&&selection.kind==="object",path=!!sel&&selection.kind==="path";
 $("empty-inspector").hidden=!!sel;
 $("property-form").hidden=!object;$("path-form").hidden=!path;
 if(object){
   $("selected-name").textContent=labels[sel.type]||sel.type;
   for(const k of ["x","y","w","h"])$("prop-"+k).value=sel[k];
   $("prop-solid").checked=sel.solid;
 }
 if(path)$("path-width").value=sel.width;
}
function setTool(next){
 if(playing)return;
 if(tool==="path"&&next!=="path")finishPath();
 if(!["select","wall","tree","water","chest","path","spawn","erase","pan"].includes(next))return;
 tool=next;
 document.querySelectorAll("[data-tool]").forEach(el=>{
  const active=el.dataset.tool===next;el.classList.toggle("active",active);el.setAttribute("aria-pressed",active?"true":"false");
 });
 canvas.style.cursor=next==="pan"?"grab":next==="select"?"default":"crosshair";
 announce(labels[next]||({"select":"選択","erase":"削除","pan":"画面移動"}[next]||next));
 render();
}
function viewCoords(e){const r=canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
const toWorld=(sx,sy)=>({x:(sx-offsetX)/zoom,y:(sy-offsetY)/zoom});
const within=(x,y)=>x>=0&&y>=0&&x<=map.width&&y<=map.height;
function resizeCanvas(){
 const box=canvas.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1);
 const w=Math.max(1,Math.round(box.width*dpr)),h=Math.max(1,Math.round(box.height*dpr));
 if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
 return {w:box.width,h:box.height,dpr};
}
function fit(){
 const box=canvas.getBoundingClientRect();
 const p=clamp(Math.min((box.width-48)/map.width,(box.height-48)/map.height),.10,2.5);
 zoom=p;offsetX=(box.width-map.width*zoom)/2;offsetY=(box.height-map.height*zoom)/2;
 refreshInfo();render();
}
function zoomAt(newZoom,sx,sy){
 const world=toWorld(sx,sy),z=clamp(newZoom,.12,3.0);
 zoom=z;offsetX=sx-world.x*z;offsetY=sy-world.y*z;
 refreshInfo();render();
}
function distanceToLine(px,py,ax,ay,bx,by){
 const dx=bx-ax,dy=by-ay,d=dx*dx+dy*dy||1;
 const t=clamp(((px-ax)*dx+(py-ay)*dy)/d,0,1);
 return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
}
function hitTest(x,y){
 const s=getSelected();
 if(s&&selection.kind==="object"&&Math.hypot(x-(s.x+s.w),y-(s.y+s.h))<Math.max(12,12/zoom))return {kind:"object",id:s.id,handle:true};
 for(let i=map.objects.length-1;i>=0;i--){const o=map.objects[i];if(x>=o.x-4&&y>=o.y-4&&x<=o.x+o.w+4&&y<=o.y+o.h+4)return {kind:"object",id:o.id};}
 for(let j=map.paths.length-1;j>=0;j--){
  const p=map.paths[j];
  for(let i=1;i<p.points.length;i++){
   if(distanceToLine(x,y,p.points[i-1].x,p.points[i-1].y,p.points[i].x,p.points[i].y)<Math.max(9,p.width*.5))return {kind:"path",id:p.id};
  }
 }
 return null;
}
function drawImage(key,x,y,w,h){
 const a=asset(key);
 if(a){ctx.save();ctx.imageSmoothingEnabled=false;ctx.drawImage(a,x,y,w,h);ctx.restore();return true}
 return false;
}
function drawPaths(){
 for(const p of map.paths){
  if(p.points.length<2)continue;
  ctx.beginPath();ctx.moveTo(p.points[0].x,p.points[0].y);
  for(let i=1;i<p.points.length;i++)ctx.lineTo(p.points[i].x,p.points[i].y);
  ctx.strokeStyle="#314936";ctx.lineWidth=p.width+9;ctx.lineCap="round";ctx.lineJoin="round";ctx.stroke();
  const tile=asset("path");ctx.strokeStyle=tile?ctx.createPattern(tile,"repeat"):"#97845e";
  ctx.lineWidth=p.width;ctx.stroke();
  if(selection?.kind==="path"&&selection.id===p.id){
   ctx.strokeStyle="#9fe6df";ctx.lineWidth=2/zoom;ctx.stroke();
   for(const v of p.points){ctx.fillStyle="#d6f8ec";ctx.fillRect(v.x-5/zoom,v.y-5/zoom,10/zoom,10/zoom);}
  }
 }
 if(pathDraft?.points.length){
  ctx.save();ctx.beginPath();const pts=pathDraft.points;
  ctx.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);
  if(pathDraft.preview)ctx.lineTo(pathDraft.preview.x,pathDraft.preview.y);
  ctx.strokeStyle="#edc687";ctx.lineWidth=76;ctx.lineCap="round";ctx.lineJoin="round";ctx.globalAlpha=.6;ctx.stroke();ctx.restore();
 }
}
function drawObject(o,selected=false){
 const {x,y,w,h,type}=o;
 ctx.save();
 if(type==="wall"){
  if(!drawImage("stone",x,y,w,h)){ctx.fillStyle="#7d8b86";ctx.fillRect(x,y,w,h);}
  ctx.fillStyle="#d1d2b755";ctx.fillRect(x,y,w,Math.min(6,h));
 }else if(type==="tree"){
  if(!drawImage("tree",x-w*.65,y-h*1.8,w*2.3,h*2.7)){
   ctx.fillStyle="#5b3e2c";ctx.fillRect(x+w*.3,y+h*.2,w*.4,h*.8);
   ctx.fillStyle="#4b8c5b";ctx.beginPath();ctx.arc(x+w*.5,y-h*.1,w*.55,0,Math.PI*2);ctx.fill();
  }
 }else if(type==="water"){
  if(!drawImage("water",x,y,w,h)){ctx.fillStyle="#2a7782";ctx.fillRect(x,y,w,h);}
  ctx.strokeStyle="#b7af93";ctx.lineWidth=7;ctx.strokeRect(x,y,w,h);
 }else if(type==="chest"){
  if(!drawImage("chest",x-5,y-7,w+10,h+11)){ctx.fillStyle="#9e7449";ctx.fillRect(x,y,w,h);}
 }
 if(o.solid){
  ctx.strokeStyle=selected?"#ffe79e":"#c9d1c75e";ctx.lineWidth=selected?2.7/zoom:1.2/zoom;
  ctx.setLineDash(selected?[]:[5/zoom,4/zoom]);ctx.strokeRect(x,y,w,h);
 }else{
  ctx.strokeStyle=selected?"#e9dbaf":"#b3b3b388";ctx.lineWidth=2/zoom;ctx.setLineDash([6/zoom,4/zoom]);ctx.strokeRect(x,y,w,h);
 }
 if(selected){
  ctx.setLineDash([]);ctx.fillStyle="#ffe6a2";
  ctx.fillRect(x+w-6/zoom,y+h-6/zoom,12/zoom,12/zoom);
  ctx.strokeStyle="#101823";ctx.lineWidth=1/zoom;ctx.strokeRect(x+w-6/zoom,y+h-6/zoom,12/zoom,12/zoom);
 }
 ctx.restore();
}
function drawSpawn(){
 const s=map.spawn;
 const mage=asset("mage");
 if(mage){ctx.save();ctx.imageSmoothingEnabled=false;ctx.drawImage(mage,0,0,40,56,s.x-17,s.y-49,34,48);ctx.restore();}
 else{ctx.fillStyle="#d9d0f1";ctx.fillRect(s.x-12,s.y-32,24,27);}
 ctx.save();ctx.strokeStyle="#f1d37e";ctx.lineWidth=2/zoom;
 ctx.beginPath();ctx.ellipse(s.x,s.y+6,17,8,0,0,Math.PI*2);ctx.stroke();
 ctx.fillStyle="#ffe9ae";ctx.font="bold 12px system-ui";ctx.textAlign="center";
 ctx.fillText("START",s.x,s.y-57);ctx.restore();
}
function render(){
 const {w,h,dpr}=resizeCanvas();
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 ctx.fillStyle="#0d1b26";ctx.fillRect(0,0,w,h);
 ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(zoom,zoom);
 ctx.fillStyle="#3b6449";
 const gr=asset("ground");if(gr)ctx.fillStyle=ctx.createPattern(gr,"repeat");
 ctx.fillRect(0,0,map.width,map.height);
 drawPaths();
 for(const o of map.objects)drawObject(o,selection?.kind==="object"&&selection.id===o.id);
 if(drawDraft)drawObject(drawDraft,true);
 if(grid&&!playing){
  ctx.save();ctx.beginPath();
  for(let x=0;x<=map.width;x+=gridSize){ctx.moveTo(x,0);ctx.lineTo(x,map.height);}
  for(let y=0;y<=map.height;y+=gridSize){ctx.moveTo(0,y);ctx.lineTo(map.width,y);}
  ctx.strokeStyle="#b8d5c62e";ctx.lineWidth=.75/zoom;ctx.stroke();ctx.restore();
 }
 ctx.strokeStyle="#e0c18e";ctx.lineWidth=3/zoom;ctx.strokeRect(0,0,map.width,map.height);
 if(playing&&player){
  ctx.save();const p=player;
  ctx.fillStyle="#15202fb0";ctx.beginPath();ctx.ellipse(p.x,p.y+7,16,6,0,0,Math.PI*2);ctx.fill();
  const sprite=asset("mage");
  if(sprite){const facings=["S","SE","E","NE","N","NW","W","SW"],j=facings.indexOf(p.facing);
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(sprite,(j%4)*40,Math.floor(j/4)*56,40,56,p.x-18,p.y-47,36,50);
  } else {ctx.fillStyle="#d7e0ea";ctx.fillRect(p.x-13,p.y-26,26,30)}
  ctx.restore();
 }else drawSpawn();
 ctx.restore();
}
function addObject(type,x,y,dragSize=null){
 const [dw,dh]=DEFAULT_SIZE[type];
 const w=Math.min(map.width,Math.max(8,dragSize?.w||dw));
 const h=Math.min(map.height,Math.max(8,dragSize?.h||dh));
 const px=clamp(snapNum(x),0,map.width-w),py=clamp(snapNum(y),0,map.height-h);
 const object={id:newId("object"),type,x:px,y:py,w,h,solid:true};
 mutate(()=>{map.objects.push(object);selection={kind:"object",id:object.id}},labels[type]+"を配置しました");
}
function addPathPoint(p){
 const point={x:clamp(snapNum(p.x),0,map.width),y:clamp(snapNum(p.y),0,map.height)};
 if(!pathDraft)pathDraft={points:[point],preview:null};
 else{
  const previous=pathDraft.points[pathDraft.points.length-1];
  if(Math.hypot(previous.x-point.x,previous.y-point.y)>1)pathDraft.points.push(point);
 }
 announce("道の頂点 "+pathDraft.points.length+" / ダブルクリックまたはEnterで確定");
 render();
}
function finishPath(){
 if(!pathDraft)return;
 const points=pathDraft.points;pathDraft=null;
 if(points.length>=2){const id=newId("path");
  mutate(()=>{map.paths.push({id,width:76,points});selection={kind:"path",id}},"道を配置しました");
 }else{announce("道には2点以上必要です");render();}
}
function removeSelection(sel=selection){
 if(!sel)return;
 mutate(()=>{
  if(sel.kind==="object")map.objects=map.objects.filter(o=>o.id!==sel.id);
  else map.paths=map.paths.filter(p=>p.id!==sel.id);
  selection=null;
 },"削除しました");
}
function onDown(e){
 if(playing)return;
 if(e.button!==0&&e.pointerType==="mouse")return;
 const s=viewCoords(e),p=toWorld(s.x,s.y);
 canvas.setPointerCapture(e.pointerId);
 if(tool==="pan"||e.button===1||keys.has("space")){
  drag={kind:"pan",sx:s.x,sy:s.y,ox:offsetX,oy:offsetY};return;
 }
 if(!within(p.x,p.y))return;
 if(tool==="path"){addPathPoint(p);return;}
 if(tool==="spawn"){
  mutate(()=>{map.spawn={x:clamp(snapNum(p.x),16,map.width-16),y:clamp(snapNum(p.y),16,map.height-16)};},"開始位置を移動しました");return;
 }
 if(tool==="erase"){removeSelection(hitTest(p.x,p.y));return;}
 if(tool==="tree"||tool==="chest"){
  addObject(tool,p.x,p.y);return;
 }
 if(tool==="wall"||tool==="water"){
  const a={x:clamp(snapNum(p.x),0,map.width),y:clamp(snapNum(p.y),0,map.height)};
  const [w,h]=DEFAULT_SIZE[tool];
  drag={kind:"draw",type:tool,start:a,startScreen:s,moved:false};
  drawDraft={type:tool,x:Math.min(a.x,map.width-w),y:Math.min(a.y,map.height-h),w,h,solid:true};render();return;
 }
 if(tool==="select"){
  selection=hitTest(p.x,p.y);
  const obj=getSelected();
  if(obj){
   drag={kind:selection.handle?"resize":"move",before:deepCopy(map),start:p,
     object:obj,origin:deepCopy(obj),handle:!!selection.handle};
  }else drag=null;
  refreshInspector();render();
 }
}
function onMove(e){
 const s=viewCoords(e),p=toWorld(s.x,s.y);
 $("coordinates").textContent="X: "+round(p.x)+" / Y: "+round(p.y);
 if(tool==="path"&&pathDraft){pathDraft.preview={x:p.x,y:p.y};render();}
 if(!drag)return;
 if(drag.kind==="pan"){
  offsetX=drag.ox+s.x-drag.sx;offsetY=drag.oy+s.y-drag.sy;render();return;
 }
 if(drag.kind==="draw"){
  const a=drag.start;
  const x=clamp(snapNum(p.x),0,map.width),y=clamp(snapNum(p.y),0,map.height);
  const dx=Math.abs(s.x-drag.startScreen.x),dy=Math.abs(s.y-drag.startScreen.y);
  drag.moved=dx>8||dy>8;
  if(drag.moved){
   drawDraft={type:drag.type,x:Math.min(a.x,x),y:Math.min(a.y,y),w:Math.max(8,Math.abs(a.x-x)),h:Math.max(8,Math.abs(a.y-y)),solid:true};
  }
  render();return;
 }
 const obj=drag.object;
 if(!obj)return;
 const dx=snapNum(p.x-drag.start.x),dy=snapNum(p.y-drag.start.y);
 if(drag.kind==="resize"&&selection.kind==="object"){
  obj.w=clamp(snapNum(drag.origin.w+dx),8,map.width-obj.x);
  obj.h=clamp(snapNum(drag.origin.h+dy),8,map.height-obj.y);
 }else if(selection.kind==="object"){
  obj.x=clamp(snapNum(drag.origin.x+dx),0,map.width-obj.w);
  obj.y=clamp(snapNum(drag.origin.y+dy),0,map.height-obj.h);
 }else if(selection.kind==="path"){
  const rawX=p.x-drag.start.x,rawY=p.y-drag.start.y;
  const minX=Math.min(...drag.origin.points.map(p=>p.x)),maxX=Math.max(...drag.origin.points.map(p=>p.x));
  const minY=Math.min(...drag.origin.points.map(p=>p.y)),maxY=Math.max(...drag.origin.points.map(p=>p.y));
  const x=clamp(snapNum(rawX),-minX,map.width-maxX),y=clamp(snapNum(rawY),-minY,map.height-maxY);
  obj.points=drag.origin.points.map(v=>({x:v.x+x,y:v.y+y}));
 }
 refreshInspector();render();
}
function onUp(e){
 if(!drag)return;
 const last=drag;drag=null;
 if(last.kind==="draw"){
  const shape=drawDraft;drawDraft=null;
  if(last.moved&&shape){
   const w=clamp(shape.w,8,map.width-shape.x),h=clamp(shape.h,8,map.height-shape.y);
   addObject(last.type,shape.x,shape.y,{w,h});
  }else addObject(last.type,last.start.x,last.start.y);
  render();return;
 }
 if(last.kind==="move"||last.kind==="resize"){
  map=validateMap(map);
  commit(last.before,{message:last.kind==="move"?"移動しました":"サイズを変更しました"});
 }
}
function onWheel(e){
 e.preventDefault();const s=viewCoords(e);
 zoomAt(zoom*(e.deltaY<0?1.14:.88),s.x,s.y);
}
function changeProperty(k,value){
 const selected=getSelected();if(!selected||selection?.kind!=="object")return;
 mutate(()=>{
  const o=getSelected();const n=Number(value);if(!Number.isFinite(n))return;
  o[k]=round(n);
  o.x=clamp(o.x,0,map.width-8);o.y=clamp(o.y,0,map.height-8);
  o.w=clamp(o.w,8,map.width-o.x);o.h=clamp(o.h,8,map.height-o.y);
 },"プロパティを変更しました");
}
function setPlaying(value){
 if(value===playing)return;
 if(value){
  finishPath();const point=nearestSafeSpawn(map);
  if(!point){announce("安全な開始位置がありません");return;}
  player={...point,facing:"S",moving:false};
  $("play").textContent="■ 編集に戻る";
  $("mode-caption").textContent="試遊モード / 衝突テスト";
  $("play-dpad").hidden=false;
 } else {
  player=null;keys.clear();touchDirections.clear();
  $("play").textContent="▶ 試遊モード";$("mode-caption").textContent="編集モード";
  $("play-dpad").hidden=true;
 }
 playing=value;document.body.classList.toggle("playing",playing);
 render();announce(value?"矢印キー / WASD / 画面パッドで移動":"編集モードに戻りました");
}
function simulate(dt){
 if(!playing||!player)return;
 let dx=(keys.has("arrowright")||keys.has("d")||touchDirections.has("right")?1:0)-
        (keys.has("arrowleft")||keys.has("a")||touchDirections.has("left")?1:0);
 let dy=(keys.has("arrowdown")||keys.has("s")||touchDirections.has("down")?1:0)-
        (keys.has("arrowup")||keys.has("w")||touchDirections.has("up")?1:0);
 const mag=Math.hypot(dx,dy);player.moving=mag>0;
 if(mag>0){
  dx/=mag;dy/=mag;
  const facing=["E","SE","S","SW","W","NW","N","NE"];
  player.facing=facing[((Math.round(Math.atan2(dy,dx)/(Math.PI/4))%8)+8)%8];
  const dist=190*dt,steps=Math.max(1,Math.ceil(dist/5));
  for(let k=0;k<steps;k++){
   const sx=dx*dist/steps,sy=dy*dist/steps;
   if(!collides(player.x+sx,player.y,15,map))player.x+=sx;
   if(!collides(player.x,player.y+sy,15,map))player.y+=sy;
  }
 }
 const box=canvas.getBoundingClientRect(),sx=player.x*zoom+offsetX,sy=player.y*zoom+offsetY;
 if(sx<box.width*.23||sx>box.width*.78)offsetX+=(box.width*.5-sx)*.12;
 if(sy<box.height*.22||sy>box.height*.75)offsetY+=(box.height*.49-sy)*.12;
}
function tick(now){
 if(playing){simulate(Math.min(.05,(now-lastTime)/1000||0));render();}
 lastTime=now;requestAnimationFrame(tick);
}
function initEvents(){
 document.querySelectorAll("[data-tool]").forEach(el=>el.addEventListener("click",()=>setTool(el.dataset.tool)));
 canvas.addEventListener("pointerdown",onDown);
 canvas.addEventListener("pointermove",onMove);
 canvas.addEventListener("pointerup",onUp);
 canvas.addEventListener("pointercancel",()=>{drag=null;drawDraft=null;render()});
 canvas.addEventListener("dblclick",()=>{if(tool==="path")finishPath()});
 canvas.addEventListener("wheel",onWheel,{passive:false});
 canvas.addEventListener("contextmenu",e=>e.preventDefault());
 $("undo").addEventListener("click",undo);$("redo").addEventListener("click",redo);
 $("snap").addEventListener("change",e=>{snap=e.target.checked;announce(snap?"グリッド吸着ON":"グリッド吸着OFF")});
 $("grid").addEventListener("change",e=>{grid=e.target.checked;render()});
 $("grid-size").addEventListener("change",e=>{gridSize=Number(e.target.value)||32;render()});
 $("zoom-in").addEventListener("click",()=>{const r=canvas.getBoundingClientRect();zoomAt(zoom*1.25,r.width/2,r.height/2)});
 $("zoom-out").addEventListener("click",()=>{const r=canvas.getBoundingClientRect();zoomAt(zoom*.8,r.width/2,r.height/2)});
 $("fit").addEventListener("click",fit);
 $("play").addEventListener("click",()=>setPlaying(!playing));
 for(const el of document.querySelectorAll("[data-dir]")){
  const dir=el.dataset.dir;
  const release=e=>{e.preventDefault();touchDirections.delete(dir)};
  el.addEventListener("pointerdown",e=>{e.preventDefault();el.setPointerCapture(e.pointerId);touchDirections.add(dir)});
  el.addEventListener("pointerup",release);
  el.addEventListener("pointercancel",release);
  el.addEventListener("lostpointercapture",()=>touchDirections.delete(dir));
 }
 $("map-name").addEventListener("change",e=>mutate(()=>{map.name=String(e.target.value).slice(0,70)},"名前を変更しました"));
 for(const k of ["width","height"]){
  $("map-"+k).addEventListener("change",e=>mutate(()=>{
   map[k]=clamp(round(Number(e.target.value)||map[k]),k==="width"?400:300,6000);
   map.objects=map.objects.map(o=>({...o,x:clamp(o.x,0,map.width-8),y:clamp(o.y,0,map.height-8),
     w:clamp(o.w,8,map.width-clamp(o.x,0,map.width-8)),h:clamp(o.h,8,map.height-clamp(o.y,0,map.height-8))}));
   for(const path of map.paths)path.points=path.points.map(p=>({x:clamp(p.x,0,map.width),y:clamp(p.y,0,map.height)}));
   map.spawn.x=clamp(map.spawn.x,16,map.width-16);map.spawn.y=clamp(map.spawn.y,16,map.height-16);
  },"フィールドサイズを変更しました"));
 }
 for(const k of ["x","y","w","h"])$("prop-"+k).addEventListener("change",e=>changeProperty(k,e.target.value));
 $("prop-solid").addEventListener("change",e=>{
  mutate(()=>{const item=getSelected();if(item)item.solid=e.target.checked},"衝突判定を更新しました")
 });
 $("path-width").addEventListener("change",e=>mutate(()=>{
  const path=getSelected();if(path&&selection.kind==="path")path.width=clamp(round(Number(e.target.value)||76),8,260)
 },"道の幅を更新しました"));
 $("delete").addEventListener("click",()=>removeSelection());
 $("path-delete").addEventListener("click",()=>removeSelection());
 $("duplicate").addEventListener("click",()=>{
  const item=getSelected();if(!item||selection.kind!=="object")return;
  const dupe={...deepCopy(item),id:newId("object"),x:clamp(item.x+32,0,map.width-item.w),y:clamp(item.y+32,0,map.height-item.h)};
  mutate(()=>{map.objects.push(dupe);selection={kind:"object",id:dupe.id}},"複製しました");
 });
 $("save").addEventListener("click",()=>persist(false));
 $("reload").addEventListener("click",()=>{
  if(!confirm("この端末に保存したマップを再読込します。よろしいですか？"))return;
  map=readLocal();selection=null;past=[];future=[];fit();refreshInfo();render();announce("保存したマップを読み込みました");
 });
 $("reset").addEventListener("click",()=>{
  if(!confirm("初期マップに戻します。編集した内容は失われます。JSON書出し済みですか？"))return;
  mutate(()=>{map=defaultMap();selection=null},"初期マップに戻しました");fit();
 });
 $("export").addEventListener("click",()=>{
  const safe=validateMap(map);
  const file=new Blob([JSON.stringify(safe,null,2)+"\n"],{type:"application/json"});
  const url=URL.createObjectURL(file),link=document.createElement("a");
  link.href=url;link.download="gedo-field-"+new Date().toISOString().slice(0,10)+".json";
  document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  announce("JSONを保存しました");
 });
 $("import").addEventListener("click",()=>$("file-input").click());
 $("file-input").addEventListener("change",async e=>{
  const file=e.target.files?.[0];e.target.value="";
  if(!file)return;
  if(file.size>2_000_000){announce("2MB以下のJSONを選択してください");return;}
  try{
   const obj=validateMap(JSON.parse(await file.text()));
   if(!confirm("読み込んだマップに切り替えます。よろしいですか？"))return;
   const before=deepCopy(map);map=obj;selection=null;commit(before,{message:"JSONを読み込みました"});fit();
  }catch(err){announce("読込エラー："+(err?.message||"無効なJSON"));}
 });
 window.addEventListener("keydown",e=>{
  const tag=e.target?.tagName;
  if(["INPUT","TEXTAREA","SELECT"].includes(tag))return;
  const key=e.key.toLowerCase();
  if((e.ctrlKey||e.metaKey)&&key==="s"){e.preventDefault();persist();return;}
  if((e.ctrlKey||e.metaKey)&&key==="z"){e.preventDefault();e.shiftKey?redo():undo();return;}
  if((e.ctrlKey||e.metaKey)&&key==="y"){e.preventDefault();redo();return;}
  if(playing){
   if(["arrowup","arrowdown","arrowleft","arrowright","w","a","s","d"].includes(key)){keys.add(key);e.preventDefault();}
   if(key==="escape")setPlaying(false);
   return;
  }
  if(key==="enter"&&tool==="path"){e.preventDefault();finishPath();return;}
  if(key==="escape"){pathDraft=null;selection=null;refreshInspector();render();return;}
  if(["delete","backspace"].includes(key)){e.preventDefault();removeSelection();return;}
  if((e.ctrlKey||e.metaKey)&&key==="d"){e.preventDefault();$("duplicate").click();return;}
  if(key===" "){keys.add("space");e.preventDefault();return;}
  const shortcuts={v:"select","1":"wall","2":"tree","3":"water","4":"chest","5":"path","6":"spawn",e:"erase",h:"pan"};
  if(shortcuts[key])setTool(shortcuts[key]);
 });
 window.addEventListener("keyup",e=>{keys.delete(e.key.toLowerCase());if(e.key===" ")keys.delete("space");});
 window.addEventListener("blur",()=>{keys.clear();touchDirections.clear()});
 new ResizeObserver(()=>render()).observe(holder);
}
map=readLocal();
initEvents();
requestAnimationFrame(()=>{fit();refreshInfo();render();requestAnimationFrame(tick)});
announce("初期マップを読み込みました。石壁などを配置できます。");
