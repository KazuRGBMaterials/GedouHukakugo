/**
 * Separate content file for the vNext playable visual.
 * Transparent five-part prototype, distinct from the canonical MAGE art.
 */
const asset = name => new URL("../../../battle/content/assets/layered-demo/" + name + ".svg", import.meta.url).href;
export default {
  kind:"characters",id:"mage-next",displayName:"MAGE・5層試作",
  graphics:{
    mode:"layered",width:30,height:42,columns:4,rows:2,
    layers:{
      skin:asset("skin"),eyes:asset("eyes"),clothes:asset("clothes"),
      hair:asset("hair"),accessories:asset("accessories")
    }
  }
};
