// Five individually replaceable transparent sheets. Not the canonical MAGE art.
export default {
  kind: "characters", id: "layered-demo", displayName: "5層描画サンプル",
  graphics: {
    mode: "layered", width: 30, height: 42, columns: 4, rows: 2,
    layers: {
      skin: "./content/assets/layered-demo/skin.svg",
      eyes: "./content/assets/layered-demo/eyes.svg",
      clothes: "./content/assets/layered-demo/clothes.svg",
      hair: "./content/assets/layered-demo/hair.svg",
      accessories: "./content/assets/layered-demo/accessories.svg"
    }
  }
};
