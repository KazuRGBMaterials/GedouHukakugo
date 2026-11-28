/* Pure smoke and regression tests: node --experimental-default-type=module docs/battle/tests/modkit-node.mjs */
import assert from "node:assert/strict";
import { createDefinitionRegistry } from "../../shared/modkit/definition-registry.js";
import { createLayeredSpriteRenderer } from "../../shared/modkit/layered-sprite.js";
import { createBattleContent } from "../content/manifest.js";
import { createBattleAI } from "../content/ai-services.js";
import { createBattle } from "../rules.js";

class Element {
  constructor() {
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.classes = new Set();
    this.classList = {
      add: key => this.classes.add(key),
      remove: key => this.classes.delete(key),
      contains: key => this.classes.has(key)
    };
  }
  replaceChildren(...nodes) { this.children = nodes; }
  append(node) { this.children.push(node); }
}

const counters = { passed: 0 };
function test(name, run) {
  run();
  counters.passed++;
  process.stdout.write("PASS " + name + "\n");
}

test("one-definition and multipack registration", () => {
  const registry = createDefinitionRegistry({ packs: [
    {kind:"characters",id:"mage"},
    {characters:[{id:"friend"}],enemies:[{id:"guard"}],maps:[{id:"cave"}]}
  ] });
  assert.equal(registry.list("characters").length, 2);
  assert.ok(registry.has("enemies","guard"));
  assert.ok(registry.has("maps","cave"));
});
test("per-kind deep base merging and no patch mutation", () => {
  const registry = createDefinitionRegistry({
    bases:{characters:{graphics:{width:30,height:42}}},
    packs:[{kind:"characters",id:"a",graphics:{height:56}}]
  });
  assert.deepEqual(registry.get("characters","a").graphics,{width:30,height:56});
  assert.ok(Object.isFrozen(registry.get("characters","a").graphics));
});
test("duplicate IDs, unsafe IDs and late additions fail", () => {
  assert.throws(()=>createDefinitionRegistry({packs:[{characters:[{id:"a"},{id:"a"}]}]}),/Duplicate/);
  assert.throws(()=>createDefinitionRegistry({packs:[{kind:"characters",id:"__proto__"}]}),/Invalid/);
  const registry = createDefinitionRegistry();registry.seal();
  assert.throws(()=>registry.register({kind:"characters",id:"a"}),/sealed/);
});
test("manifest resolves existing enemies and map provider", () => {
  const content = createBattleContent({terrainProvider:(x,y,scene)=>scene+":"+x+":"+y});
  assert.equal(content.enemyFor("hellor").characterId,"hellor");
  assert.equal(content.registry.get("objects","tree").fieldType,"tree");
  assert.equal(content.terrainFor(1,2,"ruins"),"ruins:1:2");
  assert.equal(content.visualFor("enemy",{grid:{enemyDefinitionId:"hellor"}}).width,40);
  assert.equal(content.visualFor("player",{grid:{characterBySide:{player:"layered-demo"}}}).mode,"layered");
});
test("5 layers share a direction frame", () => {
  const renderer = createLayeredSpriteRenderer({createElement:()=>new Element()});
  const sprite = new Element();
  const names=["skin","eyes","clothes","hair","accessories"];
  const layers=Object.fromEntries(names.map(name=>[name,"./"+name+".svg"]));
  const graphics={mode:"layered",width:30,height:42,columns:4,rows:2,layers};
  renderer.prepare(sprite,graphics);
  assert.equal(sprite.children.length,5);
  renderer.face(sprite,graphics,5);
  assert.ok(sprite.children.every(p=>p.style.backgroundPosition==="-30px -42px"));
  assert.deepEqual(sprite.children.map(p=>p.dataset.layer),names);
  renderer.prepare(sprite,{mode:"legacy"});
  assert.equal(sprite.children.length,0);
  assert.equal(sprite.classList.contains("is-layered"),false);
});
test("layer order accepts additional named layers", () => {
  const renderer = createLayeredSpriteRenderer({createElement:()=>new Element()});
  const sprite = new Element();
  renderer.prepare(sprite,{mode:"layered",order:["hair","skin"],layers:{skin:"s.svg",hair:"h.svg",shadow:"x.svg"}});
  assert.deepEqual(sprite.children.map(p=>p.dataset.layer),["hair","skin","shadow"]);
});
test("AI strategies inject by enemy definition ID", () => {
  const custom=()=>({id:"wait"});
  const ai=createBattleAI({extensions:{custom}});
  assert.equal(ai.forEnemy({ai:"custom"}).regular,custom);
  assert.equal(typeof ai.forEnemy({ai:"hellor"}).boss,"function");
});
test("battle rules accept injected AI without changing standard initial state", () => {
  const content=createBattleContent();
  const ai=createBattleAI();
  const battle=createBattle(true,{risk:"balanced",waste:"some",style:"power"},{
    players:1,enemies:1,enemyType:"hellor",enemyDefinitionId:"hellor",
    enemyTactics:"optimal",deciders:ai.forEnemy(content.enemyFor("hellor"))
  });
  assert.equal(battle.grid.enemyDefinitionId,"hellor");
  assert.equal(battle.grid.enemyType,"hellor");
  assert.equal(battle.player.hp,100);
  assert.equal(battle.enemy.hp,100);
});
process.stdout.write(counters.passed+" tests passed\n");
