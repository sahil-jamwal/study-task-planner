// Firebase service layer for StudyFlow.
// Uses Firebase Web SDK browser modules. No bundler and no backend required.

import { firebaseConfig, isFirebaseConfigured } from './firebaseConfig.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  writeBatch,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  enableIndexedDbPersistence
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

const service = {
  configured: false,
  app: null,
  auth: null,
  db: null,
  provider: null,
  modules: {
    doc,
    setDoc,
    getDoc,
    getDocs,
    collection,
    writeBatch,
    deleteDoc,
    onSnapshot,
    serverTimestamp,
    enableIndexedDbPersistence,
    signInWithPopup,
    signOut,
    onAuthStateChanged
  },
  error: ''
};

try {
  if (isFirebaseConfigured()) {
    service.app = initializeApp(firebaseConfig);
    service.auth = getAuth(service.app);
    service.db = getFirestore(service.app);
    service.provider = new GoogleAuthProvider();
    service.provider.setCustomParameters({ prompt: 'select_account' });
    service.configured = true;

    enableIndexedDbPersistence(service.db).catch((error) => {
      console.info('Firestore offline persistence not enabled:', error.code || error.message);
    });
  } else {
    service.error = 'Firebase is not configured yet. Add your config in firebaseConfig.js.';
  }
} catch (error) {
  console.error('Firebase initialization failed:', error);
  service.error = error.message || 'Firebase initialization failed.';
}

window.StudyFlowFirebase = service;
window.dispatchEvent(new CustomEvent('studyflow:firebase-ready', { detail: service }));
