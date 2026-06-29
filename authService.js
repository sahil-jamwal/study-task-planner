// Google sign-in through Firebase Authentication.
// Firebase sign-in controls app identity. Google Calendar permission is handled separately in googleCalendar.js.

import './firebaseService.js';

let currentUser = null;
let authReady = false;

function app() {
  return window.StudyFlowApp;
}

function firebase() {
  return window.StudyFlowFirebase;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setVisible(id, visible) {
  const element = document.getElementById(id);
  if (element) element.hidden = !visible;
}

function updateAuthUI(user, message = '') {
  const configured = Boolean(firebase()?.configured);
  currentUser = user || null;

  setText('authStatusText', configured ? (user ? 'Signed in' : 'Local mode') : 'Firebase not configured');
  setText('authUserName', user?.displayName || 'Not signed in');
  setText('authUserEmail', user?.email || 'Using this browser only');
  setText('accountModeBadge', user ? 'Cloud sync on' : 'Local only');
  setText('cloudSyncStatus', user ? 'Ready to sync' : 'Cloud sync off');
  setText('authMessage', message || (configured ? '' : firebase()?.error || 'Add Firebase config to enable login.'));

  setVisible('signInGoogleBtn', configured && !user);
  setVisible('signOutGoogleBtn', configured && Boolean(user));
  setVisible('uploadLocalToCloudBtn', configured && Boolean(user));
  setVisible('syncNowBtn', configured && Boolean(user));
}

async function signInWithGoogle() {
  const svc = firebase();
  if (!svc?.configured) {
    app()?.showToast('Firebase is not configured yet. Add firebaseConfig.js values first.');
    updateAuthUI(null, svc?.error || 'Firebase is not configured yet.');
    return;
  }

  try {
    setText('authMessage', 'Opening Google sign-in...');
    const result = await svc.modules.signInWithPopup(svc.auth, svc.provider);
    currentUser = result.user;
    updateAuthUI(currentUser, 'Signed in successfully. You can upload local data or sync cloud data.');
    window.StudyFlowCloudSync?.handleLogin(currentUser);
  } catch (error) {
    console.error('Sign-in failed:', error);
    const message = error.code === 'auth/unauthorized-domain'
      ? 'This website domain is not authorized in Firebase Authentication. Add your GitHub Pages/Netlify domain in Firebase authorized domains.'
      : error.message || 'Google sign-in failed.';
    updateAuthUI(null, message);
    app()?.showToast(message);
  }
}

async function signOutUser() {
  const svc = firebase();
  if (!svc?.configured) return;

  try {
    await svc.modules.signOut(svc.auth);
    window.StudyFlowCloudSync?.handleLogout();
    updateAuthUI(null, 'Signed out. Your local browser data is still here.');
    app()?.showToast('Signed out. Local data remains saved.');
  } catch (error) {
    console.error('Sign-out failed:', error);
    app()?.showToast('Sign-out failed. Try again.');
  }
}

function bindAuthButtons() {
  document.getElementById('signInGoogleBtn')?.addEventListener('click', signInWithGoogle);
  document.getElementById('signOutGoogleBtn')?.addEventListener('click', signOutUser);
}

function initAuthService() {
  bindAuthButtons();
  const svc = firebase();

  if (!svc?.configured) {
    updateAuthUI(null, svc?.error || 'Firebase is not configured yet.');
    return;
  }

  svc.modules.onAuthStateChanged(svc.auth, (user) => {
    authReady = true;
    currentUser = user || null;
    updateAuthUI(currentUser);
    if (user) window.StudyFlowCloudSync?.handleLogin(user);
    else window.StudyFlowCloudSync?.handleLogout();
  });
}

window.StudyFlowAuth = {
  signInWithGoogle,
  signOutUser,
  getCurrentUser: () => currentUser,
  isReady: () => authReady
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuthService);
} else {
  initAuthService();
}
