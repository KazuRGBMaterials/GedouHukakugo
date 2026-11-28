/** Nameless: purple hood, red eyes and scythe. Eight directions, five independent layers. */
const asset = name => new URL("../assets/nameless-layers/" + name + ".svg?v=1",import.meta.url).href;
export default {
 kind:"characters", id:"nameless", displayName:"ネームレス",
 graphics:{
   mode:"layered",width:40,height:56,columns:4,rows:2,
   directionFrames:[0,1,2,3,4,5,6,7],
   layers:{
     skin:asset("skin"),eyes:asset("eyes"),clothes:asset("clothes"),
     hair:asset("hair"),accessories:asset("accessories")
   }
 }
};
