/**
 * Explicit opt-in Firebase adapter. Both services share one Firebase Auth UID.
 * Firestore holds private durable saves; RTDB holds only live multiplayer data.
 * Neither SDK is imported until the user selects the relevant online feature.
 */
import {firebaseConfig} from "../../assets/firebase-config.js?v=4";
import {installationId} from "./identity.js";
const SDK="https://www.gstatic.com/firebasejs/12.11.0/";
const hasWebConfig=config=>Boolean(config?.apiKey&&config?.projectId&&config?.appId);
export const firebaseConfigured=hasWebConfig(firebaseConfig);
export const realtimeConfigured=firebaseConfigured&&Boolean(firebaseConfig?.databaseURL);

export function createFirebaseGateway({
 config=firebaseConfig,
 importer=path=>import(path),
 storage=globalThis.localStorage
}={}) {
 const configured=hasWebConfig(config);
 const realtimeReady=configured&&Boolean(config?.databaseURL);
 let identityPromise=null,firestoreSdkPromise=null,databaseSdkPromise=null;
 const load=path=>importer(SDK+path);
 async function identity() {
  if(!identityPromise)identityPromise=(async()=>{
   const [appSdk,authSdk]=await Promise.all([
    load("firebase-app.js"),load("firebase-auth.js")
   ]);
   const app=appSdk.getApps().find(item=>item.options.projectId===config.projectId)
     ||appSdk.initializeApp(config);
   const auth=authSdk.getAuth(app);
   if(typeof auth.authStateReady==="function")await auth.authStateReady();
   if(!auth.currentUser)await authSdk.signInAnonymously(auth);
   if(!auth.currentUser)throw new Error("Firebase匿名認証に失敗しました");
   return {app,auth,authSdk,uid:auth.currentUser.uid,deviceId:installationId(storage)};
  })().catch(error=>{identityPromise=null;throw error});
  return identityPromise;
 }
 return Object.freeze({
  configured,
  realtimeConfigured:realtimeReady,
  async connect(service="firestore") {
   if(service!=="firestore"&&service!=="realtime")throw new Error("Unknown Firebase service");
   if(!configured)throw new Error("Firebase Webアプリの設定がありません");
   // RTDB is available only after verified config; sign-in still waits for explicit user action.
   if(service==="realtime"&&!realtimeReady)
    throw new Error("Realtime Databaseの実際のURLが未設定です");
   const base=await identity();
   if(service==="firestore"){
    if(!firestoreSdkPromise)firestoreSdkPromise=load("firebase-firestore.js")
      .catch(error=>{firestoreSdkPromise=null;throw error});
    const firestoreApi=await firestoreSdkPromise;
    return Object.freeze({...base,firestoreApi,
      firestore:firestoreApi.getFirestore(base.app)});
   }
   if(!databaseSdkPromise)databaseSdkPromise=load("firebase-database.js")
     .catch(error=>{databaseSdkPromise=null;throw error});
   const api=await databaseSdkPromise;
   return Object.freeze({...base,api,db:api.getDatabase(base.app)});
  }
 });
}
