import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  increment
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';

export const firebaseConfig = {
  apiKey: 'AIzaSyB_WVIVpY7JrGM-O73RelpiP4JsB3Y1Cfs',
  authDomain: 'mi-negocio-de-sublimacion.firebaseapp.com',
  projectId: 'mi-negocio-de-sublimacion',
  storageBucket: 'mi-negocio-de-sublimacion.firebasestorage.app',
  messagingSenderId: '946002164875',
  appId: '1:946002164875:web:efb0ea2faf39aa8728288e'
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const clientesRef = collection(db, 'clientes');
export const pedidosRef = collection(db, 'pedidos');

export {
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  increment,
  signInAnonymously,
  onAuthStateChanged
};
