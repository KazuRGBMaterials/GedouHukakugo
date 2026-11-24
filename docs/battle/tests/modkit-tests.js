import { createDefinitionRegistry } from "../modkit/definition-registry.js";
import { createLayeredSpriteRenderer, DEFAULT_LAYER_ORDER } from "../modkit/layered-sprite.js";
import { createBattleContent } from "../content/manifest.js";

const result = document.getElementById("results");
let passed = 0, failed = 0;
function assert(test, message) { if (!test) throw new Error(message); }
function check(name, fn) {
  const row = document.createElement("li");
  try { fn(); row.textContent = "PASS " + name; row.className = "ok"; passed++; }
  catch (error) { row.textContent = "FAIL " + name + " : " + error.message; row.className = "fail"; failed++; }
  result.append(row);
}

check("1定義1ファイル", () => {
  const r = createDefinitionRegistry({ packs: [{ kind: "characters", id: "a", value: 1 }] });
  assert(r.get("characters", "a").value === 1, "single registration");
});
check("複数定義1ファイル", () => {
  const r = createDefinitionRegistry({ packs: [{ characters: [{ id: "a" }, { id: "b" }],
    maps: [{ id: "map" }] }] });
  assert(r.list("characters").length === 2 && r.has("maps", "map"), "multi pack");
});
check("基本設定と個別設定の合成", () => {
  const r = createDefinitionRegistry({
    bases: { characters: { graphics: { width: 30, height: 42 } } },
    packs: [{ kind: "characters", id: "c", graphics: { height: 56 } }]
  });
  assert(r.get("characters", "c").graphics.width === 30, "width inherited");
  assert(r.get("characters", "c").graphics.height === 56, "height overridden");
});
check("ID重複拒否", () => {
  let caught = false;
  try { createDefinitionRegistry({ packs: [{ characters: [{ id: "a" }, { id: "a" }] }] }); }
  catch { caught = true; }
  assert(caught, "duplicate allowed");
});
check("登録終了後の変更拒否", () => {
  const r = createDefinitionRegistry(); r.seal();
  let caught = false;
  try { r.register({ kind: "characters", id: "a" }); } catch { caught = true; }
  assert(caught, "sealed registry changed");
});
check("既存の敵・マップ定義", () => {
  const c = createBattleContent({ terrainProvider: (x,y,scene) => scene });
  assert(c.enemyFor("hellor").ai === "hellor", "Hellor AI mapping");
  assert(c.terrainFor(0, 0, "ruins") === "ruins", "map provider");
  assert(c.registry.has("characters","layered-demo"), "demo definition");
});
check("キャラごとの見た目選択", () => {
  const c = createBattleContent();
  assert(c.visualFor("player", {}).mode === "legacy", "player legacy");
  assert(c.visualFor("enemy", {grid:{enemyType:"hellor"}}).width === 40, "Hellor legacy");
  assert(c.visualFor("player", {grid:{characterBySide:{player:"layered-demo"}}}).mode === "layered", "character override");
});
check("基本5レイヤー順序", () => {
  assert(DEFAULT_LAYER_ORDER.join() === "skin,eyes,clothes,hair,accessories", "wrong order");
});
check("5層の生成と同一フレームへの追従", () => {
  const sprite = document.createElement("span");
  const renderer = createLayeredSpriteRenderer();
  const layers = Object.fromEntries(DEFAULT_LAYER_ORDER.map(name => [name, "./" + name + ".svg"]));
  const graphics = { mode:"layered", width:30, height:42, columns:4, rows:2, layers };
  renderer.prepare(sprite, graphics);
  assert(sprite.querySelectorAll(".sprite-part").length === 5, "not five parts");
  assert(renderer.face(sprite,graphics,5), "failed to show frame");
  assert([...sprite.children].every(part => part.style.backgroundPosition === "-30px -42px"), "frame misaligned");
  renderer.prepare(sprite,{mode:"legacy"});
  assert(sprite.children.length === 0 && !sprite.classList.contains("is-layered"), "legacy not restored");
});
check("拡張レイヤーと描画順序の個別指定", () => {
  const s = document.createElement("span");
  const r = createLayeredSpriteRenderer();
  const g = {mode:"layered",order:["hair","skin"],layers:{hair:"./hair.svg",skin:"./skin.svg",shadow:"./shadow.svg"}};
  r.prepare(s,g);
  assert([...s.children].map(e=>e.dataset.layer).join() === "hair,skin,shadow", "order ignored");
});
document.getElementById("summary").textContent = `${passed}件合格、${failed}件失敗`;
