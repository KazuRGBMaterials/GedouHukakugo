/**
 * Firebase public Web SDK app configuration.
 * Registered in project gedouhukakugo on 2026-11-28.
 *
 * The project owner reports: Realtime Database exists, RTDB security
 * rules were published, and Anonymous Authentication is enabled.
 * A successful production multi-device read/write has NOT been verified.
 *
 * Realtime Database URL was supplied by the project owner for Singapore.
 * Connections start only after explicit game UI opt-in. RTDB rules and
 * Anonymous Auth must remain enabled in Firebase Console.
 *
 * Public client keys are not Firebase administrator credentials.
 * Never commit a service account JSON file or private server key.
 * Analytics is intentionally not initialized (not needed by the game).
 */
export const firebaseConfig = Object.freeze({
  apiKey: "AIzaSyBkl9VumBiQV4bDI4hclIfg3M2thb_Ht7A",
  authDomain: "gedouhukakugo.firebaseapp.com",
  // Production RTDB URL as provided by the project owner.
  verifiedRealtimeDatabaseURL: "https://gedouhukakugo-default-rtdb.asia-southeast1.firebasedatabase.app/",
  databaseURL: "https://gedouhukakugo-default-rtdb.asia-southeast1.firebasedatabase.app/", // Enabled after owner confirmed RTDB rules + Anonymous Auth
  projectId: "gedouhukakugo",
  storageBucket: "gedouhukakugo.firebasestorage.app",
  messagingSenderId: "471281241263",
  appId: "1:471281241263:web:63d1527b81bdcc6c2dd85a",
  measurementId: "G-GF2104CTDY"
});
