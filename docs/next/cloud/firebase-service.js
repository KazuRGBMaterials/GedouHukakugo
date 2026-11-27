/**
 * Firebase is loaded ONLY after explicit user action. Until configured and
 * opted in, no Authentication, Database, identity generation or cloud writes.
 * The same Firebase app is shared with the optional legacy FIELD room module.
 */
import {firebaseConfig} from "../../assets/firebase-config.js";
import {installationId} from "./identity.js";
const SDK="https://www.gstatic.com/firebasejs/12.11.0/";
let once;
export const firebaseConfigured=Boolean(firebaseConfig?.apiKey&&firebaseConfig?.projectId&&firebaseConfig?.appId&&firebaseConfig?.databaseURL);
export function createFirebaseGateway({config=firebaseConfig, importer=path=>import(path), storage=globalThis.localStorage}={}) {
 let active;
 const configured=Boolean(config?.apiKey&&config?.projectId&&config?.appId&&config?.databaseURL);
 return Object.freeze({
  configured,
  async connect() {
   if(!configured)throw new Error("Firebase未設定です。READMEの手順でプロジェクトを接続してください");
   if(active)return active;
   if(!once)once=Promise.all([
     importer(SDK+"firebase-app.js"),
     importer(SDK+"firebase-auth.js"),
     importer(SDK+"firebase-database.js")
   ]).catch(error=>{once=undefined;throw error});
   const [appSdk,authSdk,databaseSdk]=await once;
   const app=appSdk.getApps().find(app=>app.options.projectId===config.projectId)
     || appSdk.initializeApp(config);
   const auth=authSdk.getAuth(app);
   if(typeof auth.authStateReady==="function")await auth.authStateReady();
   if(!auth.currentUser)await authSdk.signInAnonymously(auth);
   if(!auth.currentUser)throw new Error("Firebase匿名認証に失敗しました");
   active={app,auth,db:databaseSdk.getDatabase(app),api:databaseSdk,
     uid:auth.currentUser.uid,deviceId:installationId(storage),
     async linkGoogle(){
       const provider=new authSdk.GoogleAuthProvider();
       if(auth.currentUser?.isAnonymous)
         return authSdk.linkWithPopup(auth.currentUser,provider);
       return authSdk.signInWithPopup(auth,provider);
     }};
   return active;
  }
 });
}
