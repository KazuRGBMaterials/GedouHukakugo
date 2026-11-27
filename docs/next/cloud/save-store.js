/**
 * UID-scoped Realtime Database save repository with optimistic revision checks.
 * Auth and the realtime database client are injected, not imported by the core.
 * Cannot write to another player's uid, and never auto-overwrites a conflict.
 */
export const CLOUD_SCHEMA=1;
export const SLOT_NAMES=Object.freeze(["field-main","field-preview","editor-map","battle-setup"]);
export class SaveConflictError extends Error {
 constructor(){super("クラウドに別端末の新しいセーブがあります。再読込して確認してください");this.name="SaveConflictError";}
}
export function createCloudSaveStore({db,api,uid,deviceId}) {
 if(!/^[A-Za-z0-9:_-]{6,128}$/.test(String(uid)))throw new TypeError("UID missing");
 if(!/^[a-f0-9]{32}$/.test(String(deviceId)))throw new TypeError("Invalid opaque installation ID");
 const path=slot=> {
   if(!SLOT_NAMES.includes(slot))throw new Error("Unsupported save slot");
   return api.ref(db,"cloudSaves/"+uid+"/"+slot);
 };
 const decode=record=>{
  if(record==null)return null;
  if(record.schemaVersion!==CLOUD_SCHEMA||!SLOT_NAMES.includes(record.slotId)
    ||!Number.isSafeInteger(record.revision)||record.revision<1
    ||typeof record.payload!=="string"||record.payload.length>200000)
    throw new Error("保存形式が不正または未対応です");
  return {...record,data:JSON.parse(record.payload)};
 };
 return Object.freeze({
  async load(slot) {
   return decode((await api.get(path(slot))).val());
  },
  async save(slot,data,expectedRevision=null) {
   const payload=JSON.stringify(data);
   if(typeof payload!=="string"||payload.length>200000)
     throw new Error("セーブデータが大きすぎます（最大200KB）");
   const target=path(slot);
   const outcome=await api.runTransaction(target,current=>{
    const revision=current?.revision ?? null;
    if(revision!==expectedRevision)return;
    return {schemaVersion:CLOUD_SCHEMA,slotId:slot,revision:(revision||0)+1,
      deviceId,updatedAt:api.serverTimestamp(),payload};
   },{applyLocally:false});
   if(!outcome.committed)throw new SaveConflictError();
   return decode(outcome.snapshot.val());
  },
  async remove(slot,expectedRevision) {
   const outcome=await api.runTransaction(path(slot),current=>{
     if(!current || current.revision!==expectedRevision)return;
     return null;
   },{applyLocally:false});
   if(!outcome.committed)throw new SaveConflictError();
   return true;
  }
 });
}
