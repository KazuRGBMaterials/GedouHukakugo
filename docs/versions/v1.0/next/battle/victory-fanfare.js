/** Original celebratory cue: brass-like layered voices, bass and percussion.
 * Uses the existing battle audio envelope and master volume.
 */
export function victoryFanfare(t,{tone,noise}){
 const phrase=[[0,.15,392],[.16,.15,494],[.32,.16,587],[.50,.30,784],[.85,.15,659],[1.02,.16,784],[1.20,.72,1046.5]];
 for(const [offset,duration,f] of phrase){
  tone(t+offset,duration,f,f,.095,"triangle");
  tone(t+offset,duration,f,f,.036,"sawtooth");
  tone(t+offset,duration,f/2,f/2,.043,"triangle");
 }
 for(const [offset,duration,root,third,fifth] of [[0,.46,196,247,294],[.50,.60,196,262,330],[1.20,1.32,130.81,164.81,196]]){
  for(const f of [root,third,fifth])tone(t+offset,duration,f,f,.046,"triangle");
 }
 for(const offset of [0,.32,.50,.85,1.20]){
  tone(t+offset,.13,85,43,.13,"sine");
  noise(t+offset,.11,2200,.075);
 }
 noise(t+1.20,.85,6200,.065);
 tone(t+1.20,1.2,523.25,523.25,.075,"triangle");
 tone(t+1.20,1.2,659.25,659.25,.055,"triangle");
 tone(t+1.20,1.2,783.99,783.99,.055,"triangle");
}
// Ignore a finished first snapshot (late join); play only once per room.
export function createVictoryGate(play){
 let key=null,previous=null,fired=false;
 return {reset(){key=null;previous=null;fired=false;},observe(roomKey,phase,won){
  if(!roomKey)return false;
  if(roomKey!==key){key=roomKey;previous=null;fired=false;}
  const victory=!fired&&(previous==="running"||previous==="playing")&&phase==="finished"&&won;
  previous=phase;
  if(victory){fired=true;play();return true;}
  return false;
 }};
}
