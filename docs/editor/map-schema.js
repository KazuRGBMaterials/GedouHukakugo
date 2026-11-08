/* FIELD EDITOR v0.1 — pure map model. No browser, canvas, game-engine dependency. */
export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = "gedo-field-editor-autosave-v1";
export const ALLOWED_TYPES = Object.freeze(["wall","tree","water","chest"]);
export const DEFAULT_SIZE = Object.freeze({wall:[160,34],tree:[54,55],water:[200,130],chest:[48,48]});
const baseObjects=[
 ["wall",225,140,330,34],["wall",225,140,34,205],
 ["wall",580,300,34,245],["wall",580,300,185,34],["wall",963,145,34,310],
 ["tree",399,530,54,55],["tree",842,163,53,56],["tree",1108,515,53,56],
 ["water",759,581,253,132],
 ["chest",455,670,48,48],["chest",516,670,48,48]
];
export function newId(prefix="item"){
  const random = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
  return prefix+"-"+random;
}
export function defaultMap(){
 return {
   schema:"gedo-field-map", version:SCHEMA_VERSION,
   name:"古き遺跡への道", width:1600, height:1000,
   spawn:{x:160,y:520},
   objects:baseObjects.map(([type,x,y,w,h],i)=>({id:"original-"+i,type,x,y,w,h,solid:true})),
   paths:[{id:"road-original",width:76,points:[
     {x:95,y:655},{x:275,y:620},{x:325,y:450},
     {x:510,y:420},{x:790,y:455},{x:1180,y:390},
     {x:1365,y:370},{x:1570,y:314}
   ]}]
 };
}
export const deepCopy = value=>JSON.parse(JSON.stringify(value));
const integer=(v,min,max,fallback)=>{
 const n=Number(v);
 return Number.isFinite(n)?Math.max(min,Math.min(max,Math.round(n))):fallback;
};
const text=(v,max=70)=>typeof v==="string"?v.slice(0,max).replace(/[\u0000-\u001f\u007f]/g,"").trim():"";
const obj=(x)=>x!==null&&typeof x==="object"&&!Array.isArray(x);
export function validateMap(input){
 if(!obj(input))throw new Error("JSONの最上位はオブジェクトにしてください");
 if(input.schema!=="gedo-field-map"||input.version!==1)throw new Error("未対応のマップ形式です（gedo-field-map / version 1のみ）");
 if(!Array.isArray(input.objects)||!Array.isArray(input.paths))throw new Error("objectsとpathsの配列が必要です");
 if(input.objects.length>600||input.paths.length>120)throw new Error("配置数が制限を超えています（オブジェクト600、道120）");
 const width=integer(input.width,400,6000,1600),height=integer(input.height,300,6000,1000);
 const seen=new Set();
 const claim=(id,prefix)=>{
  const v=text(id,65);
  const safe=/^[\w-]{1,65}$/.test(v)&&!seen.has(v)?v:newId(prefix);
  seen.add(safe);return safe;
 };
 const objects=input.objects.map((r,i)=>{
  if(!obj(r)||!ALLOWED_TYPES.includes(r.type))throw new Error("オブジェクト"+(i+1)+"の種類が不正です");
  const x=integer(r.x,0,width-8,0),y=integer(r.y,0,height-8,0);
  const w=integer(r.w,8,width-x,48),h=integer(r.h,8,height-y,48);
  return {id:claim(r.id,"object"),type:r.type,x,y,w,h,solid:r.solid!==false};
 });
 const paths=input.paths.map((r,i)=>{
  if(!obj(r)||!Array.isArray(r.points)||r.points.length<2||r.points.length>150)throw new Error("道"+(i+1)+"の頂点数が不正です");
  return {
   id:claim(r.id,"path"),width:integer(r.width,8,260,76),
   points:r.points.map((p)=>({
    x:integer(obj(p)?p.x:NaN,0,width,0),y:integer(obj(p)?p.y:NaN,0,height,0)
   }))
  };
 });
 const spawn=obj(input.spawn)?input.spawn:{x:160,y:520};
 return {schema:"gedo-field-map",version:1,
   name:text(input.name,70)||"無題のフィールド",
   width,height,
   spawn:{x:integer(spawn.x,16,width-16,160),y:integer(spawn.y,16,height-16,520)},
   objects,paths
 };
}
export function collides(x,y,half,map){
 if(x-half<0||y-half<0||x+half>map.width||y+half>map.height)return true;
 return map.objects.some(o=>o.solid&&x+half>o.x&&x-half<o.x+o.w&&y+half>o.y&&y-half<o.y+o.h);
}
export function nearestSafeSpawn(map){
 const {x,y}=map.spawn;
 if(!collides(x,y,15,map))return {x,y};
 for(let radius=20;radius<Math.max(map.width,map.height);radius+=20){
  for(let a=0;a<24;a++){
   const angle=2*Math.PI*a/24;
   const xx=Math.round(x+Math.cos(angle)*radius),yy=Math.round(y+Math.sin(angle)*radius);
   if(!collides(xx,yy,15,map))return {x:xx,y:yy};
  }
 }
 return null;
}
