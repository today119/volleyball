/**
 * Firebase initialization using compat SDK.
 * Same pattern as MatchMaker Pro for consistency.
 */
import firebase from 'firebase/compat/app';
import 'firebase/compat/database';
import 'firebase/compat/auth';

const firebaseConfig = {
  apiKey: "AIzaSyD_1zz4i18oHdaLis82jqn3GdTbdJ1BD7k",
  authDomain: "gen-lang-client-0227397975.firebaseapp.com",
  databaseURL: "https://gen-lang-client-0227397975-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "gen-lang-client-0227397975",
  storageBucket: "gen-lang-client-0227397975.firebasestorage.app",
  messagingSenderId: "355875305396",
  appId: "1:355875305396:web:4824f48dd6559bb755a4e1",
  measurementId: "G-RRTB1NYCZ8"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

export const database = firebase.database();
export const auth = firebase.auth();
export default firebase;
