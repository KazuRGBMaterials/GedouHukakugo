/**
 * Cloud Firestore durable save repository.
 *
 * DI boundary: Firebase SDK is injected by firebase-service; game cores never
 * depend on Firebase. Owner-only access is enforced by firestore.rules.
 * Revisions are checked atomically in Firestore transactions. No silent
 * overwrites and no success claim when the server cannot acknowledge a write.
 */
export const CLOUD_SCHEMA=1;
export const SLOT_NAMES=Object.freeze(["field-main","field-preview","editor-map","battle-setup"]);
export const MAX_PAYLOAD_BYTES=200000;
export class SaveConflictError extends Error {
 constructor(){super("クラウドに別端末の新しいセーブがあります。再読込して確認してください");this.name="SaveConflictError";}
}
export function createCloudSaveStore({firestore,firestoreApi:api,uid,deviceId}) {
 if(!firestore||!api)throw new TypeError("Firestore adapter unavailable");
 if(!/^[A-Za-z0-9:_-]{6,128}$/.test(String(uid)))throw new TypeError("UID missing");
 if(!/^[a-f0-9]{32}$/.test(String(deviceId)))throw new TypeError("Invalid opaque installation ID");
 const path=slot=>{
  if(!SLOT_NAMES.includes(slot))throw new Error("Unsupported save slot");
  return api.doc(firestore,"cloudSaves",uid,"slots",slot);
 };
 const decode=(record,slot)=>{
  if(record==null)return null;
  if(record.schemaVersion!==CLOUD_SCHEMA||record.slotId!==slot
    ||!Number.isSafeInteger(record.revision)||record.revision<1
    ||typeof record.payload!=="string"||
      new TextEncoder().encode(record.payload).byteLength>MAX_PAYLOAD_BYTES)
    throw new Error("保存形式が不正または未対応です");
  return {...record,data:JSON.parse(record.payload)};
 };
 return Object.freeze({
  async load(slot) {
   const target=path(slot);
   // Fetch from the server; do not mistake a cached document for a fresh
   // cloud revision when another device might have written to it.
   const record=await api.getDocFromServer(target);
   return record.exists()?decode(record.data(),slot):null;
  },
  async save(slot,data,expectedRevision=null) {
   const payload=JSON.stringify(data);
   if(typeof payload!=="string"||
     new TextEncoder().encode(payload).byteLength>MAX_PAYLOAD_BYTES)
     throw new Error("セーブデータが大きすぎます（最大200KB）");
   const target=path(slot);
   return api.runTransaction(firestore,async transaction=>{
    const snapshot=await transaction.get(target);
    const previous=snapshot.exists()?snapshot.data():null;
    const revision=previous?.revision??null;
    if(revision!==expectedRevision)throw new SaveConflictError();
    const record={
      schemaVersion:CLOUD_SCHEMA,slotId:slot,revision:(revision||0)+1,
      deviceId,updatedAt:api.serverTimestamp(),payload
    };
    transaction.set(target,record);
    return decode(record,slot);
   });
  },
  async remove(slot,expectedRevision) {
   const target=path(slot);
   return api.runTransaction(firestore,async transaction=>{
    const snapshot=await transaction.get(target);
    if(!snapshot.exists()||snapshot.data().revision!==expectedRevision)
      throw new SaveConflictError();
    transaction.delete(target);
    return true;
   });
  }
 });
}
