/**
 * Opaque installation ID. Not an authentication credential, fingerprint,
 * IP address, hardware serial number or cross-site tracking identifier.
 * Created only when the player explicitly enables online features.
 */
export const INSTALLATION_KEY = "gedo-next-installation-id-v1";
export function installationId(storage, randomBytes = size => {
  const bytes=new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}) {
  try {
    const saved=storage?.getItem(INSTALLATION_KEY);
    if(typeof saved==="string" && /^[0-9a-f]{32}$/.test(saved))return saved;
  }catch{}
  const bytes=randomBytes(16);
  if(!bytes || bytes.length!==16)throw new Error("Secure random bytes unavailable");
  const id=Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
  try{storage?.setItem(INSTALLATION_KEY,id);}catch{}
  return id;
}
export function makeRoomCode(randomBytes = size => {
  const bytes=new Uint8Array(size);crypto.getRandomValues(bytes);return bytes;
}) {
  const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789",bytes=randomBytes(12);
  if(!bytes||bytes.length!==12)throw new Error("Secure room code generation unavailable");
  return Array.from(bytes,b=>alphabet[b%alphabet.length]).join("");
}
export function normalizeRoomCode(value) {
  const code=String(value||"").trim().toUpperCase().replace(/[ -]/g,"");
  return /^[A-HJ-NP-Z2-9]{12}$/.test(code)?code:null;
}
