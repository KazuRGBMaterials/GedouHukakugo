import {mountCloudSavePanel} from "./save-panel.js";
const port=window.__gedoNextCloudPort;
const container=document.querySelector(".save-options");
if(port && container)mountCloudSavePanel({container,slot:port.slot,port});
