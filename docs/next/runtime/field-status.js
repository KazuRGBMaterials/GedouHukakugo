/**
 * FIELD NEXT menu status — read-only presentation outside the game core.
 * Shows actual field position/facing/selected skill and clearly labels
 * prototype Lv/HP/MP as display-only, not simulated combat statistics.
 */
const DIRECTIONS=Object.freeze({
 N:"北",NE:"北東",E:"東",SE:"南東",S:"南",SW:"南西",W:"西",NW:"北西"
});
const SKILLS=Object.freeze(["炎弾","斬撃","レーザー","超高速突撃"]);

export function summarizeFieldStatus({player={},hudText="",query=""}={}) {
 const match=String(hudText).match(/SKILL\s+([1-4])/i);
 const skill=match?Number(match[1])-1:0;
 const n=value=>Number.isFinite(value)?Math.round(value):null;
 const x=n(player.x),y=n(player.y);
 const params=new URLSearchParams(query);
 const map=String(params.get("map")||"").slice(0,40);
 return Object.freeze({
  position:x===null||y===null?"取得待ち":`X ${x} / Y ${y}`,
  facing:DIRECTIONS[player.facing]||"取得待ち",
  action:player.moving?"移動中":"待機",
  skill:String(hudText).includes(" / X ")?String(hudText).replace(/^SKILL\s+[1-4]\s*·\s*/i,""):SKILLS[skill],
  field:params.has("editorMap")?"エディタ試遊":(map||"通常フィールド")
 });
}
export function mountFieldStatusMenu({
 doc=globalThis.document,
 win=globalThis.window
}={}) {
 if(!doc||!win)return null;
 const menu=doc.getElementById("game-menu");
 if(!menu)return null;
 if(doc.getElementById("next-field-status"))return null;
 const section=doc.createElement("section");
 section.id="next-field-status";
 section.className="next-field-status";
 section.setAttribute("aria-label","フィールドのステータス");
 section.innerHTML=`<div class="next-field-status-heading"><strong>STATUS / ステータス</strong><span>FIELD NEXT</span></div>
  <div class="next-field-status-name"><strong>MAGE</strong><span>Lv. 1 <small>仮</small></span></div>
  <div class="next-field-status-meters">
   <div><span>HP <small>仮</small></span><strong data-field-stat="hp">100 / 100</strong></div>
   <div><span>MP <small>仮</small></span><strong data-field-stat="mp">50 / 50</strong></div>
  </div>
  <dl class="next-field-status-values">
   <dt>現在位置</dt><dd data-field-stat="position">取得待ち</dd>
   <dt>方向</dt><dd data-field-stat="facing">取得待ち</dd>
   <dt>行動</dt><dd data-field-stat="action">待機</dd>
   <dt>選択スキル</dt><dd data-field-stat="skill">炎弾</dd>
   <dt>マップ</dt><dd data-field-stat="field">通常フィールド</dd>
  </dl>
  <p class="next-field-status-note">Lv・HP・MPは既存HUDに合わせた仮表示です。実際の成長・ダメージ管理にはまだ連動していません。</p>`;
 const title=menu.querySelector(".menu-title");
 if(title) (title.closest(".menu-toolbar")||title).insertAdjacentElement("afterend",section);
 else menu.prepend(section);
 const field=name=>section.querySelector('[data-field-stat="'+name+'"]');
 function update() {
  if(menu.hidden)return;
  let player={};
  try{player=win.__fieldTest?.getPlayer?.()||{};}catch{}
  const hud=doc.getElementById("action-hud")?.textContent||"";
  const summary=summarizeFieldStatus({player,hudText:hud,query:win.location?.search||""});
  for(const name of ["position","facing","action","skill","field"])
   field(name).textContent=summary[name];
  // Keep the prototype values consistent with the existing top-left HUD.
  const meters=doc.querySelectorAll(".character-hud .mage-meter-head span");
  if(meters[0])field("hp").textContent=meters[0].textContent;
  if(meters[1])field("mp").textContent=meters[1].textContent;
 }
 const observer=new MutationObserver(update);
 observer.observe(menu,{attributes:true,attributeFilter:["hidden"]});
 const skillHud=doc.getElementById("action-hud");
 if(skillHud)observer.observe(skillHud,{subtree:true,childList:true,characterData:true});
 const onFocus=()=>update();
 doc.addEventListener("visibilitychange",onFocus);
 update();
 return Object.freeze({element:section,refresh:update,destroy(){
  observer.disconnect();doc.removeEventListener("visibilitychange",onFocus);section.remove();
 }});
}
if(typeof document!=="undefined" && typeof window!=="undefined")
 mountFieldStatusMenu();
