import {mountCloudSavePanel} from "./save-panel.js?v=4";
const port=window.__gedoNextCloudPort;
const container=document.querySelector(".save-options");
if(port && container)mountCloudSavePanel({container,slot:port.slot,port});
