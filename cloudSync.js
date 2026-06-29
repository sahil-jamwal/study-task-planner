// Firestore cloud sync layer.
// LocalStorage remains the source for offline/local mode. Firestore is used only after Google sign-in.

import './firebaseService.js';

const CLOUD_STATE = {
  user: null,
  unsubscribeTasks: null,
  applyingCloudUpdate: false,
  syncTimer: null,
  lastCloudTaskHash: '',
  lastSyncAt: '',
  syncEnabled: true
};

function app() {
  return window.StudyFlowApp;
}

function svc() {
  return window.StudyFlowFirebase;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setMessage(message) {
  setText('syncMessage', message || '');
}

function updateSyncUI(status, message = '') {
  setText('cloudSyncStatus', status || 'Cloud sync off');
  if (CLOUD_STATE.lastSyncAt) setText('lastSyncedAt', new Date(CLOUD_STATE.lastSyncAt).toLocaleString('en-IN'));
  else setText('lastSyncedAt', 'Not synced yet');
  setMessage(message);
}

function uid() {
  return CLOUD_STATE.user?.uid || '';
}

function taskSignature(item) {
  return [
    (item.title || '').toLowerCase().trim(),
    item.dueDate || '',
    item.reminderAt || item.reminderDateTime || '',
    (item.subject || '').toLowerCase().trim(),
    (item.topic || '').toLowerCase().trim(),
    item.source || ''
  ].join('|');
}

function getLocalState() {
  return app()?.getState?.() || { items: [], dailyNotes: {}, studyPlans: [], settings: {} };
}

function toFirestoreTask(item) {
  const normalized = app()?.normalizeItem ? app().normalizeItem(item) : item;
  const now = new Date().toISOString();
  return {
    ...normalized,
    userId: uid(),
    reminderDateTime: normalized.reminderAt || normalized.reminderDateTime || '',
    updatedAt: normalized.updatedAt || now,
    deviceCreatedFrom: normalized.deviceCreatedFrom || navigator.userAgent.slice(0, 120),
    syncStatus: 'synced'
  };
}

function fromFirestoreTask(docSnap) {
  const data = docSnap.data ? docSnap.data() : docSnap;
  return app()?.normalizeItem ? app().normalizeItem({ id: docSnap.id || data.id, ...data }) : { id: docSnap.id || data.id, ...data };
}

function mergeItems(localItems = [], cloudItems = []) {
  const byId = new Map();
  const bySignature = new Map();

  [...cloudItems, ...localItems].forEach((item) => {
    if (!item?.title) return;
    const normalized = app()?.normalizeItem ? app().normalizeItem(item) : item;
    const existing = byId.get(normalized.id);

    if (existing) {
      const existingTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
      const incomingTime = new Date(normalized.updatedAt || normalized.createdAt || 0).getTime();
      byId.set(normalized.id, incomingTime >= existingTime ? { ...existing, ...normalized } : existing);
      return;
    }

    const sig = taskSignature(normalized);
    const duplicateId = bySignature.get(sig);
    if (duplicateId) {
      const oldItem = byId.get(duplicateId);
      byId.set(duplicateId, { ...oldItem, ...normalized, id: duplicateId });
      return;
    }

    byId.set(normalized.id, normalized);
    bySignature.set(sig, normalized.id);
  });

  return Array.from(byId.values()).sort((a, b) => {
    const dateA = a.dueDate || (a.reminderAt || '').slice(0, 10) || '9999-12-31';
    const dateB = b.dueDate || (b.reminderAt || '').slice(0, 10) || '9999-12-31';
    return dateA.localeCompare(dateB);
  });
}

async function loadCloudTasks() {
  if (!uid()) return [];
  const { collection, getDocs } = svc().modules;
  const snapshot = await getDocs(collection(svc().db, 'users', uid(), 'tasks'));
  return snapshot.docs.map(fromFirestoreTask).filter((item) => !item.deletedAt);
}

async function loadCloudPlans() {
  if (!uid()) return [];
  const { collection, getDocs } = svc().modules;
  const snapshot = await getDocs(collection(svc().db, 'users', uid(), 'studyPlans'));
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadCloudDailyNotes() {
  if (!uid()) return {};
  const { collection, getDocs } = svc().modules;
  const snapshot = await getDocs(collection(svc().db, 'users', uid(), 'dailyProgress'));
  const notes = {};
  snapshot.docs.forEach((d) => {
    const data = d.data();
    notes[d.id] = data.remarks || data.note || '';
  });
  return notes;
}

async function saveUserSettings(settings = {}) {
  if (!uid()) return;
  const { doc, setDoc, serverTimestamp } = svc().modules;
  await setDoc(doc(svc().db, 'users', uid()), {
    uid: uid(),
    email: CLOUD_STATE.user.email || '',
    displayName: CLOUD_STATE.user.displayName || '',
    lastSyncAt: serverTimestamp()
  }, { merge: true });
  await setDoc(doc(svc().db, 'users', uid(), 'settings', 'main'), {
    ...settings,
    lastSyncAt: serverTimestamp()
  }, { merge: true });
}

async function saveStateToCloud(stateSnapshot = getLocalState()) {
  if (!uid() || !svc()?.configured || CLOUD_STATE.applyingCloudUpdate) return;

  const { doc, writeBatch, serverTimestamp } = svc().modules;
  const batch = writeBatch(svc().db);

  batch.set(doc(svc().db, 'users', uid()), {
    uid: uid(),
    email: CLOUD_STATE.user.email || '',
    displayName: CLOUD_STATE.user.displayName || '',
    lastSyncAt: serverTimestamp()
  }, { merge: true });

  (stateSnapshot.items || []).forEach((item) => {
    const task = toFirestoreTask(item);
    batch.set(doc(svc().db, 'users', uid(), 'tasks', task.id), task, { merge: true });
  });

  (stateSnapshot.studyPlans || []).forEach((plan) => {
    if (!plan?.id) return;
    batch.set(doc(svc().db, 'users', uid(), 'studyPlans', plan.id), {
      ...plan,
      userId: uid(),
      updatedAt: new Date().toISOString()
    }, { merge: true });
  });

  Object.entries(stateSnapshot.dailyNotes || {}).forEach(([date, remarks]) => {
    batch.set(doc(svc().db, 'users', uid(), 'dailyProgress', date), {
      date,
      remarks: remarks || '',
      userId: uid(),
      updatedAt: new Date().toISOString()
    }, { merge: true });
  });

  batch.set(doc(svc().db, 'users', uid(), 'settings', 'main'), {
    ...(stateSnapshot.settings || {}),
    calendarConnected: Boolean(window.StudyFlowCalendar?.isConnected?.()),
    lastSyncAt: serverTimestamp()
  }, { merge: true });

  await batch.commit();
  CLOUD_STATE.lastSyncAt = new Date().toISOString();
  updateSyncUI('Synced', 'Cloud sync completed.');
}

function queueStateSave(stateSnapshot) {
  if (!uid() || !CLOUD_STATE.syncEnabled || CLOUD_STATE.applyingCloudUpdate) return;
  clearTimeout(CLOUD_STATE.syncTimer);
  CLOUD_STATE.syncTimer = setTimeout(async () => {
    try {
      updateSyncUI('Syncing...', 'Saving changes to cloud.');
      await saveStateToCloud(stateSnapshot || getLocalState());
    } catch (error) {
      console.error('Cloud sync failed:', error);
      updateSyncUI('Sync failed', friendlyFirestoreError(error));
    }
  }, 700);
}

async function mergeCloudIntoLocal() {
  if (!uid()) return;
  try {
    updateSyncUI('Syncing...', 'Loading cloud data.');
    const [cloudItems, cloudPlans, cloudNotes] = await Promise.all([
      loadCloudTasks(),
      loadCloudPlans(),
      loadCloudDailyNotes()
    ]);
    const local = getLocalState();
    const merged = {
      ...local,
      items: mergeItems(local.items || [], cloudItems),
      studyPlans: mergePlans(local.studyPlans || [], cloudPlans),
      dailyNotes: { ...(cloudNotes || {}), ...(local.dailyNotes || {}) },
      settings: { ...(local.settings || {}) }
    };

    CLOUD_STATE.applyingCloudUpdate = true;
    app()?.replaceState?.(merged, { skipCloud: true });
    CLOUD_STATE.applyingCloudUpdate = false;

    await saveStateToCloud(merged);
    updateSyncUI('Synced', 'Local and cloud data merged safely.');
  } catch (error) {
    CLOUD_STATE.applyingCloudUpdate = false;
    console.error('Cloud load failed:', error);
    updateSyncUI('Sync failed', friendlyFirestoreError(error));
  }
}

function mergePlans(localPlans = [], cloudPlans = []) {
  const map = new Map();
  [...cloudPlans, ...localPlans].forEach((plan) => {
    if (!plan?.id) return;
    map.set(plan.id, { ...(map.get(plan.id) || {}), ...plan });
  });
  return Array.from(map.values());
}

function listenForCloudTaskChanges() {
  if (!uid() || CLOUD_STATE.unsubscribeTasks) return;
  const { collection, onSnapshot } = svc().modules;
  CLOUD_STATE.unsubscribeTasks = onSnapshot(
    collection(svc().db, 'users', uid(), 'tasks'),
    (snapshot) => {
      const cloudItems = snapshot.docs.map(fromFirestoreTask).filter((item) => !item.deletedAt);
      const hash = JSON.stringify(cloudItems.map((item) => [item.id, item.updatedAt, item.status, item.googleCalendarEventId]));
      if (hash === CLOUD_STATE.lastCloudTaskHash) return;
      CLOUD_STATE.lastCloudTaskHash = hash;

      const local = getLocalState();
      const merged = { ...local, items: mergeItems(local.items || [], cloudItems) };
      CLOUD_STATE.applyingCloudUpdate = true;
      app()?.replaceState?.(merged, { skipCloud: true });
      CLOUD_STATE.applyingCloudUpdate = false;
      updateSyncUI('Live sync on', 'Cloud changes loaded on this device.');
    },
    (error) => {
      console.error('Realtime sync failed:', error);
      updateSyncUI('Sync listener failed', friendlyFirestoreError(error));
    }
  );
}

async function uploadLocalDataToCloud() {
  if (!uid()) {
    app()?.showToast('Please sign in first.');
    return;
  }
  const confirmed = confirm('Upload and merge this device data with your cloud account? Local data will not be deleted.');
  if (!confirmed) return;
  await saveStateToCloud(getLocalState());
  await mergeCloudIntoLocal();
  app()?.showToast('Local data uploaded and synced.');
}

async function syncNow() {
  if (!uid()) {
    app()?.showToast('Please sign in first.');
    return;
  }
  await mergeCloudIntoLocal();
}

async function deleteTask(taskId) {
  if (!uid() || !taskId) return;
  try {
    const { doc, deleteDoc } = svc().modules;
    await deleteDoc(doc(svc().db, 'users', uid(), 'tasks', taskId));
  } catch (error) {
    console.warn('Cloud delete failed:', error);
  }
}

async function deleteTasks(taskIds = []) {
  if (!uid()) return;
  await Promise.all(taskIds.map((id) => deleteTask(id)));
}

async function deleteAllCloudTasks() {
  if (!uid()) return;
  const cloudItems = await loadCloudTasks();
  await deleteTasks(cloudItems.map((item) => item.id));
}

function friendlyFirestoreError(error) {
  if (error?.code === 'permission-denied') return 'Cloud permission denied. Check Firestore security rules.';
  if (error?.code === 'unavailable') return 'Network issue. Your data is still saved locally and will sync later.';
  return error?.message || 'Cloud sync failed.';
}

function hasMeaningfulLocalData() {
  const local = getLocalState();
  return Boolean((local.items || []).length || (local.studyPlans || []).length || Object.keys(local.dailyNotes || {}).length);
}

function handleLogin(user) {
  CLOUD_STATE.user = user;
  listenForCloudTaskChanges();
  if (hasMeaningfulLocalData()) {
    updateSyncUI('Cloud ready', 'You are signed in. Click Upload local data to cloud if you want to merge this device with your account.');
  } else {
    updateSyncUI('Loading cloud data...', 'No local data found, so cloud data will load automatically.');
    mergeCloudIntoLocal();
  }
}

function handleLogout() {
  CLOUD_STATE.user = null;
  if (CLOUD_STATE.unsubscribeTasks) CLOUD_STATE.unsubscribeTasks();
  CLOUD_STATE.unsubscribeTasks = null;
  updateSyncUI('Cloud sync off', 'Signed out. Local data remains saved on this device.');
}

function bindCloudButtons() {
  document.getElementById('uploadLocalToCloudBtn')?.addEventListener('click', uploadLocalDataToCloud);
  document.getElementById('syncNowBtn')?.addEventListener('click', syncNow);
}

window.StudyFlowCloudSync = {
  handleLogin,
  handleLogout,
  queueStateSave,
  saveStateToCloud,
  mergeCloudIntoLocal,
  uploadLocalDataToCloud,
  syncNow,
  deleteTask,
  deleteTasks,
  deleteAllCloudTasks,
  getUser: () => CLOUD_STATE.user,
  isApplyingCloudUpdate: () => CLOUD_STATE.applyingCloudUpdate
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindCloudButtons);
else bindCloudButtons();
