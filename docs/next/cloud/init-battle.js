import "../battle/battle.js?v=8";
import {mountCloudSavePanel} from "./save-panel.js";
const port=window.__gedoNextBattleCloudPort;
const container=document.getElementById("battle-cloud-target");
if(port&&container)mountCloudSavePanel({container,port,slot:"battle-setup"});
