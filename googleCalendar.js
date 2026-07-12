// Google Calendar automatic event creation through Google Identity Services.
// This is separate from Firebase Auth. Firebase signs you into the app; this asks for Calendar permission.
// Access token is kept only in memory and is not stored in LocalStorage.

import { googleCalendarConfig, isGoogleCalendarConfigured } from './firebaseConfig.js';

const CALENDAR_STATE = {
  tokenClient: null,
  accessToken: '',
  tokenExpiresAt: 0,
  connected: false,
  pendingResolver: null
};

function app() {
  return window.StudyFlowApp;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function updateCalendarUI(status, message = '') {
  setText('calendarStatusText', status);
  setText('calendarMessage', message);
}

function initTokenClient() {
  if (!isGoogleCalendarConfigured()) {
    updateCalendarUI('Calendar not configured', 'Add your Google OAuth Web Client ID in firebaseConfig.js.');
    return false;
  }
  if (!window.google?.accounts?.oauth2) {
    updateCalendarUI('Calendar library loading', 'Reload if Google Identity Services is blocked or slow.');
    return false;
  }
  if (CALENDAR_STATE.tokenClient) return true;

  CALENDAR_STATE.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: googleCalendarConfig.clientId,
    scope: googleCalendarConfig.calendarScope,
    callback: (response) => {
      if (response.error) {
        CALENDAR_STATE.pendingResolver?.reject?.(new Error(response.error_description || response.error));
        CALENDAR_STATE.pendingResolver = null;
        return;
      }
      CALENDAR_STATE.accessToken = response.access_token;
      CALENDAR_STATE.tokenExpiresAt = Date.now() + Number(response.expires_in || 3300) * 1000;
      CALENDAR_STATE.connected = true;
      updateCalendarUI('Connected', 'Calendar permission granted for this browser session.');
      CALENDAR_STATE.pendingResolver?.resolve?.(response.access_token);
      CALENDAR_STATE.pendingResolver = null;
    }
  });
  return true;
}

function requestToken(prompt = '') {
  return new Promise((resolve, reject) => {
    if (!initTokenClient()) {
      reject(new Error('Google Calendar is not configured or not loaded.'));
      return;
    }
    CALENDAR_STATE.pendingResolver = { resolve, reject };
    try {
      CALENDAR_STATE.tokenClient.requestAccessToken({ prompt });
    } catch (error) {
      CALENDAR_STATE.pendingResolver = null;
      reject(error);
    }
  });
}

async function ensureAccessToken(interactive = true) {
  if (CALENDAR_STATE.accessToken && Date.now() < CALENDAR_STATE.tokenExpiresAt - 60000) {
    return CALENDAR_STATE.accessToken;
  }
  return requestToken(interactive ? 'consent' : '');
}

async function connectCalendar() {
  try {
    await ensureAccessToken(true);
    app()?.showToast('Google Calendar connected.');
  } catch (error) {
    console.error('Calendar connect failed:', error);
    const message = friendlyCalendarError(error);
    updateCalendarUI('Calendar not connected', message);
    app()?.showToast(message);
  }
}

function taskToCalendarEvent(item) {
  const reminder = item.reminderAt || item.reminderDateTime || (item.dueDate ? `${item.dueDate}T09:00` : '');
  if (!reminder) throw new Error('Add a reminder date/time or due date before syncing this task.');

  const start = new Date(reminder);
  if (Number.isNaN(start.getTime())) throw new Error('Task reminder date/time is invalid.');
  const minutes = Number(item.estimateMinutes || item.estimatedMinutes || 30) || 30;
  const end = new Date(start.getTime() + Math.max(15, Math.min(minutes, 240)) * 60000);

  const description = [
    item.subject ? `Subject: ${item.subject}` : '',
    item.topic ? `Topic: ${item.topic}` : '',
    item.subtopic ? `Subtopic: ${item.subtopic}` : '',
    item.assignment ? `Assignment: ${item.assignment}` : '',
    item.youtubeLink ? `YouTube: ${item.youtubeLink}` : '',
    item.priority ? `Priority: ${item.priority}` : '',
    item.difficulty ? `Difficulty: ${item.difficulty}` : '',
    item.source ? `Source: ${item.source}` : '',
    item.notes ? `Notes: ${item.notes}` : '',
    '',
    `Created from StudyFlow Planner. Local task id: ${item.id}`
  ].filter(Boolean).join('\n');

  return {
    summary: item.title || item.topic || 'StudyFlow task',
    description,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    reminders: {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 10 }]
    },
    extendedProperties: {
      private: {
        localTaskId: item.id || '',
        source: item.source || item.category || 'StudyFlow'
      }
    }
  };
}

async function createOrUpdateEvent(itemId) {
  const state = app()?.getState?.();
  const item = state?.items?.find((entry) => entry.id === itemId);
  if (!item) throw new Error('Task not found.');

  try {
    await ensureAccessToken(true);
    updateCalendarUI('Syncing event...', `Creating calendar event for ${item.title}`);
    const eventBody = taskToCalendarEvent(item);
    const eventId = item.googleCalendarEventId;
    const url = eventId
      ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`
      : 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
    const response = await fetch(url, {
      method: eventId ? 'PUT' : 'POST',
      headers: {
        Authorization: `Bearer ${CALENDAR_STATE.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(eventBody)
    });

    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error?.message || `Calendar API error ${response.status}`);
    }

    const savedEvent = await response.json();
    item.googleCalendarEventId = savedEvent.id;
    item.calendarSyncStatus = 'synced';
    item.calendarSyncedAt = new Date().toISOString();
    item.calendarSyncError = '';
    app()?.replaceState?.(state);
    app()?.showToast('Calendar event synced.');
    updateCalendarUI('Connected', 'Calendar event synced successfully.');
    return savedEvent;
  } catch (error) {
    console.error('Calendar event sync failed:', error);
    item.calendarSyncStatus = 'failed';
    item.calendarSyncError = friendlyCalendarError(error);
    app()?.replaceState?.(state);
    updateCalendarUI('Calendar sync failed', item.calendarSyncError);
    app()?.showToast(item.calendarSyncError);
    throw error;
  }
}

async function syncTodayEvents() {
  const state = app()?.getState?.();
  const today = app()?.todayISO?.() || new Date().toISOString().slice(0, 10);
  const items = (state?.items || []).filter((item) => {
    const reminderDate = (item.reminderAt || item.reminderDateTime || '').slice(0, 10);
    return item.status !== 'Done' && (item.dueDate === today || reminderDate === today);
  });
  if (!items.length) {
    app()?.showToast('No pending items for today.');
    return;
  }
  await syncItemList(items);
}

async function syncPendingCalendarEvents() {
  const state = app()?.getState?.();
  const items = (state?.items || []).filter((item) => {
    const hasDate = item.reminderAt || item.reminderDateTime || item.dueDate;
    return item.status !== 'Done' && hasDate && item.calendarSyncStatus !== 'synced';
  }).slice(0, 50);
  if (!items.length) {
    app()?.showToast('No calendar-pending items found.');
    return;
  }
  await syncItemList(items);
}

async function syncItemList(items) {
  let success = 0;
  for (const item of items) {
    try {
      await createOrUpdateEvent(item.id);
      success += 1;
    } catch {
      // Error is already shown on item and status panel.
    }
  }
  app()?.showToast(`${success}/${items.length} calendar events synced.`);
}

// Delete the Google Calendar event linked to a task (best effort).
// Called when a task is deleted in StudyFlow so the calendar stays in sync.
async function deleteEventForItem(item) {
  const eventId = item?.googleCalendarEventId;
  if (!eventId) return false;
  try {
    if (!CALENDAR_STATE.accessToken || Date.now() >= CALENDAR_STATE.tokenExpiresAt - 60000) {
      if (!isGoogleCalendarConfigured() || !window.google?.accounts?.oauth2) return false;
      await requestToken(''); // silent token attempt; if it fails we skip quietly
    }
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${CALENDAR_STATE.accessToken}` } }
    );
    // 404/410 mean the event is already gone — treat as success.
    if (response.ok || response.status === 404 || response.status === 410) {
      updateCalendarUI('Connected', 'Linked calendar event deleted.');
      return true;
    }
    return false;
  } catch (error) {
    console.warn('Calendar delete skipped:', error?.message || error);
    return false;
  }
}

function friendlyCalendarError(error) {
  const text = error?.message || String(error || '');
  if (text.includes('popup')) return 'Popup was blocked. Allow popups for this website and try again.';
  if (text.includes('access_denied')) return 'Calendar permission was denied. Manual Google Calendar link still works.';
  if (text.includes('origin')) return 'Google OAuth origin mismatch. Add this website URL in Google Cloud authorized JavaScript origins.';
  if (text.includes('invalid_client')) return 'Google OAuth client ID is wrong or not authorized for this website.';
  if (text.includes('401')) return 'Calendar token expired. Click Connect Google Calendar again.';
  return text || 'Calendar sync failed.';
}

function bindCalendarButtons() {
  document.getElementById('connectCalendarBtn')?.addEventListener('click', connectCalendar);
  document.getElementById('syncTodayCalendarBtn')?.addEventListener('click', syncTodayEvents);
  document.getElementById('syncPendingCalendarBtn')?.addEventListener('click', syncPendingCalendarEvents);

  if (!isGoogleCalendarConfigured()) {
    updateCalendarUI('Calendar not configured', 'Add Google OAuth client ID in firebaseConfig.js. Manual Calendar links still work.');
  } else {
    updateCalendarUI('Not connected', 'Click Connect Google Calendar when you want automatic event creation.');
  }
}

window.StudyFlowCalendar = {
  connectCalendar,
  createOrUpdateEvent,
  deleteEventForItem,
  syncTodayEvents,
  syncPendingCalendarEvents,
  isConnected: () => CALENDAR_STATE.connected,
  hasToken: () => Boolean(CALENDAR_STATE.accessToken)
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindCalendarButtons);
else bindCalendarButtons();
