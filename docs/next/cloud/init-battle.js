import "../battle/battle.js?v=8";
import {mountCloudSavePanel} from "./save-panel.js?v=4";
const port=window.__gedoNextBattleCloudPort;
const container=document.getElementById("battle-cloud-target");
if(port&&container)mountCloudSavePanel({container,port,slot:"battle-setup"});
