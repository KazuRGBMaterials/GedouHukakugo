/** Invoke directly from a button tap to preserve native share user activation. */
export async function shareInvite(url,nav=globalThis.navigator){
 if(!url)return "manual";
 if(typeof nav?.share==="function"){
  try{await nav.share({title:"外道不覚悟 — ルーム招待",text:"一緒に遊ぼう！",url});return "shared";}
  catch(error){if(error?.name==="AbortError")return "cancelled";}
 }
 try{await nav.clipboard.writeText(url);return "copied";}
 catch{return "manual";}
}
