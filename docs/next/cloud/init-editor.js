// Wait for the existing editor module to initialize; import URLs must match.
import "../editor/editor.js?v=8";
import {mountCloudSavePanel} from "./save-panel.js";
const port=window.__gedoNextEditorCloudPort;
const container=document.querySelector("aside");
if(port && container)mountCloudSavePanel({container,slot:"editor-map",port});
