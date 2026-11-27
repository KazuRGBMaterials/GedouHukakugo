/**
 * Firebase public Web SDK app configuration.
 * Registered in project gedouhukakugo on 2026-11-28.
 *
 * The project owner must still create Realtime Database and enable
 * Authentication > Sign-in method > Anonymous; publish the security
 * rules in docs/firebase/database.rules.json before any online access.
 *
 * databaseURL is intentionally null until the real URL has been read
 * from Realtime Database > Data. Never guess the database region.
 *
 * Public client keys are not Firebase administrator credentials.
 * Never commit a service account JSON file or private server key.
 * Analytics is intentionally not initialized (not needed by the game).
 */
export const firebaseConfig = Object.freeze({
  apiKey: "AIzaSyBkl9VumBiQV4bDI4hclIfg3M2thb_Ht7A",
  authDomain: "gedouhukakugo.firebaseapp.com",
  databaseURL: null, // Await actual Realtime Database URL
  projectId: "gedouhukakugo",
  storageBucket: "gedouhukakugo.firebasestorage.app",
  messagingSenderId: "471281241263",
  appId: "1:471281241263:web:63d1527b81bdcc6c2dd85a",
  measurementId: "G-GF2104CTDY"
});
