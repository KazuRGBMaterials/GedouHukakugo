/**
 * Authentic MAGE pixel art: one 8-direction, 40x56 transparent sprite
 * split into skin/eyes/clothes/hair/accessories SVG masks.
 * All five pieces contain original pixels, not the temporary demo character.
 */
const asset = name => new URL("../assets/mage-layers/" + name + ".svg?v=6", import.meta.url).href;
const original = new URL("../../../assets/mage-8dir.png", import.meta.url).href;
export default {
  kind:"characters", id:"mage-next", displayName:"MAGE（原画5レイヤー）",
  graphics:{
    mode:"layered",width:40,height:56,columns:4,rows:2,
    directionFrames:[0,1,2,3,4,5,6,7],
    original,
    layers:{
      skin:asset("skin"),eyes:asset("eyes"),clothes:asset("clothes"),
      hair:asset("hair"),accessories:asset("accessories")
    }
  }
};
