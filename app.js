'use strict';

const STORAGE_KEY = 'studyflowPlanner.pro.v1';
const OLD_STORAGE_KEY = 'studyTaskPlanner.v1';

const DEFAULT_STATE = {
  items: [],
  dailyNotes: {},
  studyPlans: [],
  settings: { theme: 'light', boardView: false, defaultReminderMinutes: 10, defaultStudyHours: 2, preferredStudyDays: [1,2,3,4,5,6], calendarConnected: false, lastSyncAt: '' }
};

const REQUIRED_COLUMNS = ['Task Title'];
const TEMPLATE_COLUMNS = [
  'Task Title', 'Category', 'Subject', 'Topic', 'YouTube Link', 'Assignment',
  'Due Date', 'Reminder Date Time', 'Priority', 'Status', 'Estimated Minutes', 'Notes'
];

let state = loadState();
let pendingImportRows = [];
let activeChip = 'all';
let activeStatus = 'active';
let lastUndo = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(OLD_STORAGE_KEY);
    if (!saved) return cloneDefault();
    const parsed = JSON.parse(saved);
    return {
      ...cloneDefault(),
      ...parsed,
      items: Array.isArray(parsed.items) ? parsed.items.map(normalizeItem) : [],
      dailyNotes: parsed.dailyNotes && typeof parsed.dailyNotes === 'object' ? parsed.dailyNotes : {},
      studyPlans: Array.isArray(parsed.studyPlans) ? parsed.studyPlans : [],
      settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) }
    };
  } catch (error) {
    console.error('Load failed:', error);
    return cloneDefault();
  }
}

function saveState(options = {}) {
  state.settings.lastLocalSaveAt = nowISO();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!options.skipCloud && window.StudyFlowCloudSync?.queueStateSave) {
    window.StudyFlowCloudSync.queueStateSave(JSON.parse(JSON.stringify(state)));
  }
}

function uid() {
  return `item_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function todayISO() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function nowISO() {
  return new Date().toISOString();
}

function cleanText(value, limit = 700) {
  return String(value ?? '').trim().slice(0, limit);
}

function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeStatus(value) {
  const status = cleanText(value);
  const lookup = {
    'not started': 'Not Started', 'pending': 'Not Started', 'todo': 'Not Started', 'to do': 'Not Started',
    'in progress': 'In Progress', 'progress': 'In Progress', 'doing': 'In Progress',
    'done': 'Done', 'completed': 'Done', 'complete': 'Done'
  };
  return lookup[status.toLowerCase()] || ['Not Started', 'In Progress', 'Done'].find((x) => x === status) || 'Not Started';
}

function normalizePriority(value) {
  const priority = cleanText(value);
  const lookup = { high: 'High', medium: 'Medium', med: 'Medium', low: 'Low' };
  return lookup[priority.toLowerCase()] || ['High', 'Medium', 'Low'].find((x) => x === priority) || 'Medium';
}

function normalizeCategory(value) {
  const category = cleanText(value);
  const lookup = { task: 'Task', study: 'Study', assignment: 'Assignment', assignments: 'Assignment' };
  return lookup[category.toLowerCase()] || ['Task', 'Study', 'Assignment'].find((x) => x === category) || 'Task';
}

function normalizeMinutes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return '';
  return Math.min(Math.round(number), 600);
}

function normalizeItem(item) {
  const status = normalizeStatus(item.status);
  return {
    id: item.id || uid(),
    title: cleanText(item.title || item['Task Title'] || item.taskTitle, 120),
    category: normalizeCategory(item.category || item.Category),
    subject: cleanText(item.subject || item.Subject, 80),
    topic: cleanText(item.topic || item.Topic, 120),
    youtubeLink: cleanText(item.youtubeLink || item['YouTube Link'] || item.video || item.Video, 300),
    assignment: cleanText(item.assignment || item.Assignment, 180),
    dueDate: normalizeDate(item.dueDate || item['Due Date']),
    reminderAt: normalizeDateTime(item.reminderAt || item['Reminder Date Time']),
    priority: normalizePriority(item.priority || item.Priority),
    status,
    estimateMinutes: normalizeMinutes(item.estimateMinutes || item['Estimated Minutes']),
    notes: cleanText(item.notes || item.Notes, 700),
    createdAt: item.createdAt || nowISO(),
    completedAt: status === 'Done' ? (item.completedAt || nowISO()) : '',
    source: cleanText(item.source || '', 60),
    planId: cleanText(item.planId || '', 80),
    scheduleKind: cleanText(item.scheduleKind || '', 50),
    scheduledDate: normalizeDate(item.scheduledDate || item.dueDate || item['Due Date']),
    subtopic: cleanText(item.subtopic || item.Subtopic || '', 120),
    difficulty: cleanText(item.difficulty || item.Difficulty || '', 20),
    revisionCount: Number.isFinite(Number(item.revisionCount)) ? Number(item.revisionCount) : 0,
    missedReason: cleanText(item.missedReason || '', 300),
    rescheduledDate: normalizeDate(item.rescheduledDate || ''),
    userId: cleanText(item.userId || '', 120),
    updatedAt: item.updatedAt || item.createdAt || nowISO(),
    deviceCreatedFrom: cleanText(item.deviceCreatedFrom || '', 160),
    syncStatus: cleanText(item.syncStatus || 'local', 30),
    googleCalendarEventId: cleanText(item.googleCalendarEventId || '', 160),
    calendarSyncStatus: cleanText(item.calendarSyncStatus || 'not_synced', 40),
    calendarSyncedAt: item.calendarSyncedAt || '',
    calendarSyncError: cleanText(item.calendarSyncError || '', 300),
    reminderDateTime: normalizeDateTime(item.reminderDateTime || item.reminderAt || item['Reminder Date Time'])
  };
}

function normalizeDate(value) {
  if (!value) return '';
  if (typeof value === 'number' && window.XLSX) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function normalizeDateTime(value) {
  if (!value) return '';
  if (typeof value === 'number' && window.XLSX) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}T${String(parsed.H || 9).padStart(2, '0')}:${String(parsed.M || 0).padStart(2, '0')}`;
    }
  }
  const text = String(value).trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return text.slice(0, 16);
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString();
  return local.slice(0, 16);
}

function isHttpUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function getDatePart(value) {
  return value ? String(value).slice(0, 10) : '';
}

function getItemDate(item) {
  return item.dueDate || getDatePart(item.reminderAt) || '';
}

function isPending(item) { return item.status !== 'Done'; }

function isDueToday(item) {
  const today = todayISO();
  return item.dueDate === today || getDatePart(item.reminderAt) === today;
}

function isOverdue(item) {
  const date = item.dueDate || getDatePart(item.reminderAt);
  return isPending(item) && date && date < todayISO();
}

function isWithinNextDays(item, days) {
  const date = getItemDate(item);
  if (!date) return false;
  const start = new Date(`${todayISO()}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  const itemDate = new Date(`${date}T00:00:00`);
  return itemDate >= start && itemDate <= end;
}

function priorityRank(priority) {
  return { High: 1, Medium: 2, Low: 3 }[priority] || 2;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    ...(value.includes('T') ? { hour: '2-digit', minute: '2-digit' } : {})
  });
}

function shortDate(value) {
  if (!value) return 'No date';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  const today = todayISO();
  if (value === today) return 'Today';
  if (value === addDaysLocal(today, 1)) return 'Tomorrow';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function addDaysLocal(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/* ---------------- Toast + Undo ---------------- */
function showToast(message, undoFn) {
  const toast = $('#toast');
  $('#toastText').textContent = message;
  const actionBtn = $('#toastAction');
  if (undoFn) {
    actionBtn.hidden = false;
    actionBtn.textContent = 'Undo';
    lastUndo = undoFn;
  } else {
    actionBtn.hidden = true;
    lastUndo = null;
  }
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.classList.remove('show'); lastUndo = null; }, undoFn ? 5000 : 2300);
}

/* ---------------- Reminders (browser notifications + in-app) ---------------- */
let firedReminders = loadFiredReminders();

function loadFiredReminders() {
  try {
    const raw = localStorage.getItem('studyflow.firedReminders');
    const obj = raw ? JSON.parse(raw) : {};
    return new Set(Object.keys(obj));
  } catch { return new Set(); }
}

function saveFiredReminders() {
  try {
    const today = todayISO();
    const obj = {};
    firedReminders.forEach((key) => {
      const when = key.split('|')[1] || '';
      if (when.slice(0, 10) === today) obj[key] = 1; // keep only today's, so it never grows large
    });
    firedReminders = new Set(Object.keys(obj));
    localStorage.setItem('studyflow.firedReminders', JSON.stringify(obj));
  } catch { /* ignore */ }
}

function requestReminderPermission() {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  } catch { /* ignore */ }
}

function notifyUser(title, body) {
  showToast(title);
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const note = new Notification(title, { body: body || '' });
      note.onclick = () => { try { window.focus(); } catch {} note.close(); };
    }
  } catch { /* ignore */ }
}

// Fires any reminders whose time has arrived today and that haven't already fired.
// Note: this works while StudyFlow is open in the browser (it is not a background push service).
function checkReminders() {
  const now = Date.now();
  const today = todayISO();
  let changed = false;
  state.items.forEach((item) => {
    if (item.status === 'Done' || !item.reminderAt) return;
    if (getDatePart(item.reminderAt) !== today) return; // only today's, no old spam
    const time = new Date(item.reminderAt).getTime();
    if (Number.isNaN(time) || time > now) return;
    const key = `${item.id}|${item.reminderAt}`;
    if (firedReminders.has(key)) return;
    firedReminders.add(key);
    changed = true;
    const detail = [item.subject, item.topic].filter(Boolean).join(' • ') || 'Open StudyFlow to continue.';
    notifyUser(`Reminder: ${item.title}`, detail);
  });
  if (changed) saveFiredReminders();
}

function startReminderEngine() {
  checkReminders();
  setInterval(checkReminders, 30000); // check every 30 seconds while the app is open
}

/* ---------------- Navigation ---------------- */
const VIEW_TITLES = { dashboard: 'Today', tasks: 'Tasks', scheduler: 'Plan', settings: 'Settings' };
const VIEW_REDIRECT = { study: 'tasks', assignments: 'tasks', videos: 'tasks', daily: 'dashboard', excel: 'settings' };

function setView(viewId, options = {}) {
  if (VIEW_REDIRECT[viewId]) {
    if (viewId === 'study') activeChip = 'Study';
    if (viewId === 'assignments') activeChip = 'Assignment';
    if (viewId === 'videos') activeChip = 'Video';
    viewId = VIEW_REDIRECT[viewId];
  }
  if (options.chip) activeChip = options.chip;
  $$('.view').forEach((view) => view.classList.toggle('active-view', view.id === viewId));
  $$('.nav-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === viewId));
  $$('.mobile-nav-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === viewId));
  $('#viewTitle').textContent = VIEW_TITLES[viewId] || 'Today';
  if (viewId === 'tasks') syncChipUI();
  closeAllMenus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme;
  $('#themeToggle').textContent = state.settings.theme === 'dark' ? '☀' : '☾';
}

/* ---------------- Item mutations ---------------- */
function saveItem(item) {
  item.updatedAt = nowISO();
  item.deviceCreatedFrom = item.deviceCreatedFrom || navigator.userAgent.slice(0, 120);
  item.syncStatus = window.StudyFlowCloudSync?.getUser?.() ? 'pending' : 'local';
  const index = state.items.findIndex((entry) => entry.id === item.id);
  if (index >= 0) state.items[index] = item;
  else state.items.unshift(item);
  saveState();
  renderAll();
}

function deleteItem(id) {
  const index = state.items.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  const [removed] = state.items.splice(index, 1);
  window.StudyFlowCloudSync?.deleteTask?.(id);
  saveState();
  renderAll();
  showToast(`Deleted “${removed.title}”`, () => {
    state.items.splice(Math.min(index, state.items.length), 0, removed);
    saveState();
    renderAll();
    showToast('Restored');
  });
}

function editItem(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  openAddDialog(item);
}

function toggleDone(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  if (item.status === 'Done') {
    item.status = 'In Progress';
    item.completedAt = '';
  } else {
    item.status = 'Done';
    item.completedAt = nowISO();
  }
  item.updatedAt = nowISO();
  item.syncStatus = window.StudyFlowCloudSync?.getUser?.() ? 'pending' : item.syncStatus;
  saveState();
  renderAll();
}

function updateStatus(id, status) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  item.status = normalizeStatus(status);
  item.completedAt = item.status === 'Done' ? (item.completedAt || nowISO()) : '';
  item.updatedAt = nowISO();
  item.syncStatus = window.StudyFlowCloudSync?.getUser?.() ? 'pending' : item.syncStatus;
  saveState();
  renderAll();
}

/* ---------------- Calendar link ---------------- */
function makeGoogleDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function getCalendarUrl(item) {
  const baseTime = item.reminderAt || (item.dueDate ? `${item.dueDate}T09:00` : '');
  if (!baseTime) return '';
  const start = new Date(baseTime);
  if (Number.isNaN(start.getTime())) return '';
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const details = [
    item.subject ? `Subject: ${item.subject}` : '',
    item.topic ? `Topic: ${item.topic}` : '',
    item.assignment ? `Assignment: ${item.assignment}` : '',
    item.youtubeLink ? `Video: ${item.youtubeLink}` : '',
    item.notes ? `Notes: ${item.notes}` : '',
    'Created from StudyFlow.'
  ].filter(Boolean).join('\n');
  const params = new URLSearchParams({
    action: 'TEMPLATE', text: item.title,
    dates: `${makeGoogleDate(start)}/${makeGoogleDate(end)}`, details
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function getYouTubeId(url) {
  if (!url || !isHttpUrl(url)) return '';
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) return parsed.pathname.slice(1);
    if (parsed.searchParams.get('v')) return parsed.searchParams.get('v');
    const shorts = parsed.pathname.match(/\/shorts\/([^/?]+)/);
    if (shorts) return shorts[1];
    const embed = parsed.pathname.match(/\/embed\/([^/?]+)/);
    if (embed) return embed[1];
    return '';
  } catch { return ''; }
}

/* ---------------- Cards ---------------- */
function metaLine(item) {
  const bits = [];
  if (item.subject) bits.push(escapeHTML(item.subject));
  if (item.topic) bits.push(escapeHTML(item.topic));
  const date = getItemDate(item);
  if (date) bits.push(shortDate(date));
  if (item.estimateMinutes) bits.push(`${item.estimateMinutes} min`);
  return bits.join(' · ');
}

function itemCard(item, options = {}) {
  const overdue = isOverdue(item);
  const done = item.status === 'Done';
  const calendarUrl = getCalendarUrl(item);
  const videoUrl = item.youtubeLink && isHttpUrl(item.youtubeLink) ? item.youtubeLink : '';
  const inProgress = item.status === 'In Progress';
  const tagBits = [];
  if (item.category && item.category !== 'Task') tagBits.push(`<span class="tag tag-${item.category.toLowerCase()}">${escapeHTML(item.category)}</span>`);
  if (item.priority === 'High' && !done) tagBits.push('<span class="tag tag-high">High</span>');
  if (overdue) tagBits.push('<span class="tag tag-overdue">Overdue</span>');
  if (item.scheduleKind) tagBits.push(`<span class="tag">${escapeHTML(item.scheduleKind)}</span>`);

  return `
    <article class="item-card ${done ? 'done' : ''} ${overdue ? 'overdue-card' : ''}" data-id="${escapeHTML(item.id)}">
      <button class="check ${done ? 'checked' : ''}" data-action="toggle" data-id="${escapeHTML(item.id)}" type="button" aria-label="${done ? 'Mark not done' : 'Mark done'}">${done ? '✓' : ''}</button>
      <div class="item-body" data-action="edit" data-id="${escapeHTML(item.id)}">
        <p class="item-title">${escapeHTML(item.title)}</p>
        ${metaLine(item) ? `<p class="item-meta">${metaLine(item)}</p>` : ''}
        ${item.assignment && options.showAssignment !== false ? `<p class="item-assignment">${escapeHTML(item.assignment)}</p>` : ''}
        ${tagBits.length ? `<div class="tag-row">${tagBits.join('')}</div>` : ''}
      </div>
      <div class="card-menu-wrap">
        <button class="menu-btn" data-action="menu" data-id="${escapeHTML(item.id)}" type="button" aria-label="More actions">⋯</button>
        <div class="card-menu" hidden>
          <button data-action="edit" data-id="${escapeHTML(item.id)}" type="button">Edit</button>
          ${!done ? `<button data-action="progress" data-id="${escapeHTML(item.id)}" type="button">${inProgress ? 'In progress' : 'Start'}</button>` : ''}
          ${videoUrl ? `<a href="${escapeHTML(videoUrl)}" target="_blank" rel="noopener">Open video</a>` : ''}
          ${calendarUrl ? `<a href="${escapeHTML(calendarUrl)}" target="_blank" rel="noopener">Add to Calendar</a>` : ''}
          <button class="danger" data-action="delete" data-id="${escapeHTML(item.id)}" type="button">Delete</button>
        </div>
      </div>
    </article>
  `;
}

function emptyState(title, text, actionLabel, actionView) {
  const btn = actionLabel ? `<button class="primary-btn" data-empty-action="${escapeHTML(actionView || '')}" type="button">${escapeHTML(actionLabel)}</button>` : '';
  return `<div class="empty-state"><div class="empty-mark">✶</div><strong>${escapeHTML(title)}</strong><p>${escapeHTML(text)}</p>${btn}</div>`;
}

/* ---------------- Filters ---------------- */
function matchesChip(item, chip) {
  if (chip === 'all') return true;
  if (chip === 'Study') return item.category === 'Study';
  if (chip === 'Assignment') return item.category === 'Assignment' || Boolean(item.assignment);
  if (chip === 'Video') return Boolean(item.youtubeLink) && isHttpUrl(item.youtubeLink);
  return true;
}

function getFilteredItems() {
  const search = cleanText($('#searchInput')?.value).toLowerCase();
  const when = $('#whenFilter')?.value || 'all';
  return state.items.filter((item) => {
    if (!matchesChip(item, activeChip)) return false;
    if (activeStatus === 'active' && item.status === 'Done') return false;
    if (activeStatus === 'Done' && item.status !== 'Done') return false;
    const haystack = [item.title, item.subject, item.topic, item.assignment, item.notes].join(' ').toLowerCase();
    if (search && !haystack.includes(search)) return false;
    if (when === 'today' && !isDueToday(item)) return false;
    if (when === 'week' && !isWithinNextDays(item, 7)) return false;
    if (when === 'overdue' && !isOverdue(item)) return false;
    if (when === 'noDate' && getItemDate(item)) return false;
    return true;
  }).sort(sortSmart);
}

function sortSmart(a, b) {
  const aOver = isOverdue(a) ? 0 : 1;
  const bOver = isOverdue(b) ? 0 : 1;
  if (aOver !== bOver) return aOver - bOver;
  const aDone = a.status === 'Done' ? 1 : 0;
  const bDone = b.status === 'Done' ? 1 : 0;
  if (aDone !== bDone) return aDone - bDone;
  const dateA = getItemDate(a) || '9999-12-31';
  const dateB = getItemDate(b) || '9999-12-31';
  if (dateA !== dateB) return dateA.localeCompare(dateB);
  return priorityRank(a.priority) - priorityRank(b.priority);
}

function sortTodayItems(items) {
  const mode = $('#todaySort')?.value || 'smart';
  const copy = [...items];
  if (mode === 'priority') return copy.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  if (mode === 'time') return copy.sort((a, b) => (a.reminderAt || '9999').localeCompare(b.reminderAt || '9999'));
  return copy.sort(sortSmart);
}

function getTodayFocusItems() {
  const today = todayISO();
  return state.items.filter((item) =>
    isDueToday(item) || isOverdue(item) || (item.status === 'Done' && getDatePart(item.completedAt) === today)
  );
}

// Returns 0-100, or -1 to mean "nothing scheduled for today" (so the UI can show a friendly note
// instead of a discouraging 0%).
function calculateTodayProgress() {
  const items = getTodayFocusItems();
  if (!items.length) return -1;
  const done = items.filter((item) => item.status === 'Done').length;
  return Math.round((done / items.length) * 100);
}

/* ---------------- Render: Today ---------------- */
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function renderToday() {
  const todayItems = sortTodayItems(state.items.filter((item) => (isDueToday(item) || isOverdue(item))));
  const pendingToday = todayItems.filter(isPending);
  const overdue = state.items.filter(isOverdue);
  const progress = calculateTodayProgress();
  const hasToday = progress >= 0;
  const shownPercent = hasToday ? progress : 0;

  const remaining = pendingToday.length;
  $('#greetingText').textContent = remaining
    ? `${greeting()}. ${remaining} thing${remaining > 1 ? 's' : ''} left today.`
    : `${greeting()}. You're all clear for today.`;
  $('#todayProgressBar').style.width = `${shownPercent}%`;
  $('#todayProgressText').textContent = hasToday ? `${progress}%` : 'No tasks due';
  $('#sidebarProgressBar').style.width = `${shownPercent}%`;
  $('#sidebarProgressText').textContent = hasToday ? `${progress}%` : '—';

  // Next up = first pending item (today/overdue first, else any pending)
  const nextUp = pendingToday[0] || state.items.filter(isPending).sort(sortSmart)[0];
  const nextWrap = $('#nextUpWrap');
  if (nextUp) {
    nextWrap.innerHTML = `
      <div class="next-up-card">
        <p class="next-up-title">${escapeHTML(nextUp.title)}</p>
        ${metaLine(nextUp) ? `<p class="next-up-meta">${metaLine(nextUp)}</p>` : ''}
        ${nextUp.assignment ? `<p class="next-up-assignment">${escapeHTML(nextUp.assignment)}</p>` : ''}
        <div class="next-up-actions">
          <button class="primary-btn" data-action="toggle" data-id="${escapeHTML(nextUp.id)}" type="button">Mark done</button>
          <button class="soft-btn" data-action="focus" type="button">Focus</button>
          ${nextUp.youtubeLink && isHttpUrl(nextUp.youtubeLink) ? `<a class="soft-btn" href="${escapeHTML(nextUp.youtubeLink)}" target="_blank" rel="noopener">Open video</a>` : ''}
        </div>
      </div>`;
    $('#nextUpBlock').hidden = false;
  } else {
    nextWrap.innerHTML = emptyState('Nothing queued', 'Add a task or generate a study plan to get started.', '+ Add task', 'add');
    $('#nextUpBlock').hidden = false;
  }

  // Overdue nudge
  const nudge = $('#overdueNudge');
  if (overdue.length) {
    nudge.hidden = false;
    nudge.innerHTML = `<span>⚠ ${overdue.length} overdue item${overdue.length > 1 ? 's' : ''}.</span> <button class="link-btn" data-overdue-jump type="button">Review</button>`;
  } else {
    nudge.hidden = true;
  }

  // Today list (the rest after next-up)
  const rest = todayItems.filter((item) => item.id !== nextUp?.id);
  $('#todayListWrap').innerHTML = rest.length
    ? rest.map((item) => itemCard(item)).join('')
    : (todayItems.length ? '' : emptyState('Your day is clear', 'No tasks due today. Enjoy it, or plan ahead.', null));

  // Reflection note
  const today = todayISO();
  const note = $('#reflectionNote');
  if (note && document.activeElement !== note) note.value = state.dailyNotes[today] || '';
}

/* ---------------- Render: Tasks ---------------- */
function syncChipUI() {
  $$('#taskChips .chip').forEach((c) => c.classList.toggle('active', c.dataset.chip === activeChip));
  $$('#statusSeg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.status === activeStatus));
}

function renderTasks() {
  syncChipUI();
  const items = getFilteredItems();
  $('#resultCount').textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;

  const emptyMsg = state.items.length
    ? emptyState('No matching tasks', 'Try a different filter or search.', null)
    : emptyState('No tasks yet', 'Capture your first task — it takes seconds.', '+ Add task', 'add');

  $('#allItems').innerHTML = items.length ? items.map((item) => itemCard(item)).join('') : emptyMsg;

  const statuses = ['Not Started', 'In Progress', 'Done'];
  $('#boardItems').innerHTML = statuses.map((status) => {
    const columnItems = items.filter((item) => item.status === status);
    return `
      <section class="board-column">
        <h4>${escapeHTML(status)} <span class="pill">${columnItems.length}</span></h4>
        <div class="card-list">
          ${columnItems.length ? columnItems.map((item) => itemCard(item)).join('') : '<p class="muted small">Empty</p>'}
        </div>
      </section>`;
  }).join('');

  $('#allItems').hidden = Boolean(state.settings.boardView);
  $('#boardItems').hidden = !state.settings.boardView;
  $('#listViewBtn').classList.toggle('active', !state.settings.boardView);
  $('#boardViewBtn').classList.toggle('active', Boolean(state.settings.boardView));
}

/* ---------------- Render all ---------------- */
function renderAll() {
  const dateText = new Date(`${todayISO()}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  });
  $('#currentDate').textContent = dateText;
  updateAccountBadge();
  renderToday();
  renderTasks();
  if (typeof renderScheduler === 'function') renderScheduler();
}

function updateAccountBadge() {
  const user = window.StudyFlowCloudSync?.getUser?.();
  const badge = $('#accountModeBadge');
  if (badge && !user) badge.textContent = 'Local only';
}

/* ---------------- Unified Add / Edit dialog ---------------- */
function openAddDialog(item = null) {
  const dialog = $('#addDialog');
  $('#addEditingId').value = item?.id || '';
  $('#addDialogTitle').textContent = item ? 'Edit task' : 'Add task';
  $('#addTitle').value = item?.title || '';
  $('#addCategory').value = item?.category || 'Task';
  $('#addPriority').value = item?.priority || 'Medium';
  $('#addDueDate').value = item?.dueDate || '';
  $('#addReminderAt').value = item?.reminderAt || '';
  $('#addSubject').value = item?.subject || '';
  $('#addTopic').value = item?.topic || '';
  $('#addYoutube').value = item?.youtubeLink || '';
  $('#addAssignment').value = item?.assignment || '';
  $('#addEstimate').value = item?.estimateMinutes || '';
  $('#addStatus').value = item?.status || 'Not Started';
  $('#addNotes').value = item?.notes || '';
  // Expand advanced if any advanced field is set
  const hasAdvanced = item && (item.subject || item.topic || item.youtubeLink || item.assignment || item.estimateMinutes || item.notes || item.status === 'In Progress');
  setAdvanced(Boolean(hasAdvanced));
  if (typeof dialog.showModal === 'function') dialog.showModal();
  setTimeout(() => $('#addTitle').focus(), 30);
}

function setAdvanced(open) {
  $('#addAdvanced').hidden = !open;
  $('#addMoreToggle').setAttribute('aria-expanded', String(open));
  $('#addMoreToggle').textContent = open ? 'Fewer details ▴' : 'More details ▾';
}

function buildItemFromDialog() {
  const id = $('#addEditingId').value;
  const existing = id ? state.items.find((i) => i.id === id) : null;
  const title = cleanText($('#addTitle').value, 120);
  if (!title) throw new Error('Please enter a title.');
  const youtubeLink = cleanText($('#addYoutube').value, 300);
  if (youtubeLink && !isHttpUrl(youtubeLink)) throw new Error('Video link must start with http:// or https://');
  const status = normalizeStatus($('#addStatus').value);
  return normalizeItem({
    id: id || uid(),
    title,
    category: $('#addCategory').value,
    subject: $('#addSubject').value,
    topic: $('#addTopic').value,
    youtubeLink,
    assignment: $('#addAssignment').value,
    dueDate: $('#addDueDate').value,
    reminderAt: $('#addReminderAt').value,
    priority: $('#addPriority').value,
    status,
    estimateMinutes: $('#addEstimate').value,
    notes: $('#addNotes').value,
    createdAt: existing?.createdAt || nowISO(),
    completedAt: status === 'Done' ? (existing?.completedAt || nowISO()) : '',
    source: existing?.source || '',
    planId: existing?.planId || '',
    scheduleKind: existing?.scheduleKind || '',
    scheduledDate: existing?.scheduledDate || $('#addDueDate').value,
    subtopic: existing?.subtopic || '',
    difficulty: existing?.difficulty || '',
    revisionCount: existing?.revisionCount || 0,
    missedReason: existing?.missedReason || '',
    rescheduledDate: existing?.rescheduledDate || ''
  });
}

/* ---------------- Overflow menus ---------------- */
function closeAllMenus(except) {
  $$('.card-menu').forEach((menu) => { if (menu !== except) menu.hidden = true; });
}

/* ---------------- Focus mode with timer ---------------- */
let focusState = { id: null, intervalId: null, remaining: 0, elapsed: 0, running: false, mode: 'up' };

function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function stopFocusTimer() {
  if (focusState.intervalId) clearInterval(focusState.intervalId);
  focusState.intervalId = null;
  focusState.running = false;
}

function focusClockValue() {
  return focusState.mode === 'down' ? focusState.remaining : focusState.elapsed;
}

function tickFocus() {
  if (!focusState.running) return;
  if (focusState.mode === 'down') {
    focusState.remaining -= 1;
    if (focusState.remaining <= 0) {
      focusState.remaining = 0;
      focusState.running = false;
      const clockEl = $('#focusClock');
      if (clockEl) clockEl.textContent = "Time's up";
      notifyUser('Focus session complete', 'Nice work — your planned time is up.');
      const toggleBtn = $('#focusToggleBtn');
      if (toggleBtn) toggleBtn.hidden = true;
      return;
    }
  } else {
    focusState.elapsed += 1;
  }
  const clockEl = $('#focusClock');
  if (clockEl) clockEl.textContent = formatClock(focusClockValue());
}

function renderFocus(item) {
  const minutes = Number(item.estimateMinutes) || 0;
  $('#focusContent').innerHTML = `
    <div class="focus-card">
      <span class="tag tag-${item.priority.toLowerCase()}">${escapeHTML(item.priority)}</span>
      <h4>${escapeHTML(item.title)}</h4>
      <p class="muted">${escapeHTML([item.subject, item.topic, minutes ? `Planned ${minutes} min` : ''].filter(Boolean).join(' • '))}</p>
      ${item.assignment ? `<p class="item-assignment">${escapeHTML(item.assignment)}</p>` : ''}
      <div class="focus-clock" id="focusClock">${formatClock(focusClockValue())}</div>
      <div class="form-actions" style="justify-content:center;margin-top:10px;">
        <button class="soft-btn" id="focusToggleBtn" data-action="focus-toggle" type="button">Pause</button>
        <button class="primary-btn" data-action="focus-done" type="button">Done</button>
      </div>
    </div>`;
}

function openFocus(itemId) {
  const dialog = $('#focusDialog');
  const item = itemId
    ? state.items.find((entry) => entry.id === itemId)
    : state.items.filter(isPending).sort(sortSmart)[0];

  if (!item) {
    stopFocusTimer();
    $('#focusContent').innerHTML = emptyState('Nothing pending', 'You have no pending tasks right now.', null);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    return;
  }

  // Starting focus means the task is now in progress.
  if (item.status !== 'Done') {
    item.status = 'In Progress';
    item.updatedAt = nowISO();
    item.syncStatus = window.StudyFlowCloudSync?.getUser?.() ? 'pending' : item.syncStatus;
    saveState();
    renderToday();
    renderTasks();
  }

  stopFocusTimer();
  const minutes = Number(item.estimateMinutes) || 0;
  focusState = { id: item.id, intervalId: null, remaining: minutes * 60, elapsed: 0, running: true, mode: minutes > 0 ? 'down' : 'up' };
  renderFocus(item);
  focusState.intervalId = setInterval(tickFocus, 1000);
  if (typeof dialog.showModal === 'function') dialog.showModal();
}

// Backwards-compatible alias (older code/buttons may still call openFocusMode).
function openFocusMode() { openFocus(); }

function toggleFocusTimer() {
  focusState.running = !focusState.running;
  const btn = $('#focusToggleBtn');
  if (btn) btn.textContent = focusState.running ? 'Pause' : 'Resume';
}

function finishFocus() {
  const id = focusState.id;
  stopFocusTimer();
  $('#focusDialog').close();
  if (id) toggleDone(id);
}

/* ---------------- Excel ---------------- */
function renderExcelPreview(rows, errors = []) {
  pendingImportRows = rows;
  $('#importRows').disabled = rows.length === 0;
  $('#clearPreview').disabled = rows.length === 0 && errors.length === 0;
  $('#importSummary').hidden = false;
  $('#importSummary').innerHTML = `${rows.length} valid row${rows.length === 1 ? '' : 's'} ready. ${errors.length ? `${errors.length} row${errors.length === 1 ? '' : 's'} skipped (missing title).` : ''}`;

  if (!rows.length) {
    $('#excelPreview').innerHTML = emptyState('No valid rows', 'Make sure your file has a Task Title column.', null);
    return;
  }
  const header = TEMPLATE_COLUMNS.map((col) => `<th>${escapeHTML(col)}</th>`).join('');
  const body = rows.slice(0, 25).map((item) => `
    <tr>
      <td>${escapeHTML(item.title)}</td><td>${escapeHTML(item.category)}</td><td>${escapeHTML(item.subject)}</td>
      <td>${escapeHTML(item.topic)}</td><td>${escapeHTML(item.youtubeLink)}</td><td>${escapeHTML(item.assignment)}</td>
      <td>${escapeHTML(item.dueDate)}</td><td>${escapeHTML(item.reminderAt)}</td><td>${escapeHTML(item.priority)}</td>
      <td>${escapeHTML(item.status)}</td><td>${escapeHTML(item.estimateMinutes)}</td><td>${escapeHTML(item.notes)}</td>
    </tr>`).join('');
  $('#excelPreview').innerHTML = `
    <table class="preview-table"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>
    ${rows.length > 25 ? `<p class="muted">Showing first 25 of ${rows.length} rows.</p>` : ''}`;
}

function handleExcelFile(file) {
  if (!file) return;
  if (!window.XLSX) { showToast('Spreadsheet library still loading — reload once online.'); return; }
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = new Uint8Array(event.target.result);
      const workbook = XLSX.read(data, { type: 'array', cellDates: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const rows = [];
      const errors = [];
      json.forEach((row, index) => {
        const item = normalizeItem({
          title: row['Task Title'] || row.Title || row.Task || row.task,
          category: row.Category, subject: row.Subject, topic: row.Topic,
          youtubeLink: row['YouTube Link'] || row.Video || row['Video Link'],
          assignment: row.Assignment, dueDate: row['Due Date'],
          reminderAt: row['Reminder Date Time'] || row.Reminder,
          priority: row.Priority, status: row.Status,
          estimateMinutes: row['Estimated Minutes'], notes: row.Notes
        });
        if (!item.title) errors.push(index + 2);
        else rows.push(item);
      });
      renderExcelPreview(rows, errors);
      showToast('Excel preview ready');
    } catch (error) {
      console.error(error);
      showToast('Could not read that file. Check the format.');
    }
  };
  reader.readAsArrayBuffer(file);
}

function clearExcelPreview() {
  pendingImportRows = [];
  $('#excelFile').value = '';
  $('#excelPreview').innerHTML = '';
  $('#importSummary').hidden = true;
  $('#importRows').disabled = true;
  $('#clearPreview').disabled = true;
}

function downloadCSVTemplate() {
  const sample = [
    TEMPLATE_COLUMNS,
    ['Watch SQL Joins Video', 'Study', 'SQL', 'Joins', 'https://youtube.com/', 'Practice 10 join questions', todayISO(), `${todayISO()} 19:00`, 'High', 'Not Started', '45', 'Revise after practice'],
    ['Complete Power BI Assignment', 'Assignment', 'Power BI', 'DAX', '', 'Create 3 measures', todayISO(), '', 'Medium', 'Not Started', '60', '']
  ];
  const csv = sample.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
  downloadBlob(csv, 'studyflow_excel_template.csv', 'text/csv');
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}

function exportBackup() {
  downloadBlob(JSON.stringify(state, null, 2), `studyflow_backup_${todayISO()}.json`, 'application/json');
  showToast('Backup exported');
}

function importBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const imported = JSON.parse(event.target.result);
      if (!Array.isArray(imported.items)) throw new Error('Invalid backup');
      state = {
        ...cloneDefault(), ...imported,
        items: imported.items.map(normalizeItem),
        dailyNotes: imported.dailyNotes || {},
        studyPlans: Array.isArray(imported.studyPlans) ? imported.studyPlans : [],
        settings: { ...DEFAULT_STATE.settings, ...(imported.settings || {}) }
      };
      saveState(); applyTheme(); renderAll();
      showToast('Backup imported');
    } catch (error) {
      console.error(error);
      showToast('Invalid backup file');
    }
  };
  reader.readAsText(file);
}

/* ---------------- Demo seed (dev only) ---------------- */
function seedDemoData() {
  if (!new URLSearchParams(location.search).has('demo')) return;
  if (state.items.length) return;
  const today = todayISO();
  state.items = [
    normalizeItem({ title: 'Watch SQL Joins video', category: 'Study', subject: 'SQL', topic: 'Joins', youtubeLink: 'https://www.youtube.com/', assignment: 'Practice 10 join questions', dueDate: today, reminderAt: `${today}T19:00`, priority: 'High', status: 'Not Started', estimateMinutes: 45, notes: 'Focus on INNER, LEFT, RIGHT JOIN.' }),
    normalizeItem({ title: 'Complete Power BI assignment', category: 'Assignment', subject: 'Power BI', topic: 'DAX', assignment: 'Create 3 measures and test output', dueDate: today, priority: 'Medium', status: 'In Progress', estimateMinutes: 60 }),
    normalizeItem({ title: 'English speaking practice', category: 'Task', subject: 'English', topic: 'Intro practice', dueDate: today, priority: 'Low', status: 'Not Started', estimateMinutes: 20 })
  ];
  saveState();
}

/* ---------------- Events ---------------- */
function handleItemAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const id = button.dataset.id;
  const action = button.dataset.action;
  if (action === 'menu') {
    event.stopPropagation();
    const menu = button.parentElement.querySelector('.card-menu');
    const willOpen = menu.hidden;
    closeAllMenus();
    menu.hidden = !willOpen;
    return;
  }
  if (action === 'edit') { closeAllMenus(); editItem(id); }
  if (action === 'delete') { closeAllMenus(); deleteItem(id); }
  if (action === 'toggle') toggleDone(id);
  if (action === 'progress') { closeAllMenus(); openFocus(id); }
  if (action === 'focus') openFocus(id);
  if (action === 'focus-toggle') toggleFocusTimer();
  if (action === 'focus-done') finishFocus();
}

function bindEvents() {
  $$('.nav-btn, .mobile-nav-btn').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.view)));

  $('#themeToggle').addEventListener('click', () => {
    state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    saveState(); applyTheme();
  });

  // Add dialog
  $('#addBtn').addEventListener('click', () => openAddDialog());
  $('#fab').addEventListener('click', () => openAddDialog());
  $('#closeAddDialog').addEventListener('click', () => $('#addDialog').close());
  $('#addMoreToggle').addEventListener('click', () => setAdvanced($('#addAdvanced').hidden));
  $('#addForm').addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const isEdit = Boolean($('#addEditingId').value);
      const hasReminder = Boolean($('#addReminderAt').value);
      saveItem(buildItemFromDialog());
      if (hasReminder) requestReminderPermission();
      $('#addDialog').close();
      showToast(isEdit ? 'Task updated' : 'Task added');
    } catch (error) { showToast(error.message); }
  });

  // Focus
  $('#closeFocus').addEventListener('click', () => { stopFocusTimer(); $('#focusDialog').close(); });

  // Cards (delegated)
  document.body.addEventListener('click', handleItemAction);
  document.addEventListener('click', (e) => { if (!e.target.closest('.card-menu-wrap')) closeAllMenus(); });

  // Empty-state action buttons
  document.body.addEventListener('click', (e) => {
    const emptyBtn = e.target.closest('[data-empty-action]');
    if (emptyBtn) {
      const target = emptyBtn.dataset.emptyAction;
      if (target === 'add') openAddDialog(); else if (target) setView(target);
    }
    if (e.target.closest('[data-overdue-jump]')) { setView('tasks'); $('#whenFilter').value = 'overdue'; renderTasks(); }
  });

  // Tasks chips + filters
  $('#taskChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    activeChip = chip.dataset.chip;
    renderTasks();
  });
  $('#statusSeg').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    activeStatus = b.dataset.status;
    renderTasks();
  });
  ['searchInput', 'whenFilter', 'todaySort'].forEach((id) => {
    const el = $(`#${id}`);
    if (!el) return;
    el.addEventListener('input', () => { id === 'todaySort' ? renderToday() : renderTasks(); });
    el.addEventListener('change', () => { id === 'todaySort' ? renderToday() : renderTasks(); });
  });

  $('#listViewBtn').addEventListener('click', () => { state.settings.boardView = false; saveState(); renderTasks(); });
  $('#boardViewBtn').addEventListener('click', () => { state.settings.boardView = true; saveState(); renderTasks(); });

  // Reflection note
  $('#saveReflection')?.addEventListener('click', () => {
    const date = todayISO();
    state.dailyNotes[date] = cleanText($('#reflectionNote').value, 1500);
    saveState();
    showToast('Note saved');
  });

  // Excel
  $('#excelFile').addEventListener('change', (event) => handleExcelFile(event.target.files[0]));
  $('#downloadTemplate').addEventListener('click', downloadCSVTemplate);
  $('#clearPreview').addEventListener('click', clearExcelPreview);
  $('#importRows').addEventListener('click', () => {
    if (!pendingImportRows.length) return;
    const existingSignatures = new Set(state.items.map((item) => [item.title, item.dueDate, item.reminderAt, item.subject, item.topic].join('|').toLowerCase()));
    const importRows = pendingImportRows
      .map((item) => normalizeItem({ ...item, source: item.source || 'Excel Upload', updatedAt: nowISO() }))
      .filter((item) => {
        const signature = [item.title, item.dueDate, item.reminderAt, item.subject, item.topic].join('|').toLowerCase();
        if (existingSignatures.has(signature)) return false;
        existingSignatures.add(signature);
        return true;
      });
    state.items = [...importRows, ...state.items];
    saveState(); clearExcelPreview(); renderAll();
    showToast(`${importRows.length} row${importRows.length === 1 ? '' : 's'} imported`);
  });

  const dropZone = $('#dropZone');
  ['dragenter', 'dragover'].forEach((type) => dropZone.addEventListener(type, (event) => { event.preventDefault(); dropZone.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((type) => dropZone.addEventListener(type, (event) => { event.preventDefault(); dropZone.classList.remove('dragging'); }));
  dropZone.addEventListener('drop', (event) => handleExcelFile(event.dataTransfer.files[0]));

  // Backup + danger
  $('#exportBackup').addEventListener('click', exportBackup);
  $('#importBackup').addEventListener('change', (event) => importBackup(event.target.files[0]));
  $('#clearCompleted').addEventListener('click', () => {
    const removed = state.items.filter((item) => item.status === 'Done');
    if (!removed.length) { showToast('Nothing completed to clear'); return; }
    const deletedIds = removed.map((item) => item.id);
    state.items = state.items.filter((item) => item.status !== 'Done');
    window.StudyFlowCloudSync?.deleteTasks?.(deletedIds);
    saveState(); renderAll();
    showToast(`${removed.length} cleared`, () => {
      state.items = [...removed, ...state.items];
      saveState(); renderAll(); showToast('Restored');
    });
  });
  $('#deleteAll').addEventListener('click', () => {
    if (!confirm('Delete ALL tasks, study items, and notes? This cannot be undone.')) return;
    state = cloneDefault();
    window.StudyFlowCloudSync?.deleteAllCloudTasks?.();
    saveState(); applyTheme(); renderAll();
    showToast('All data deleted');
  });

  // Toast undo
  $('#toastAction').addEventListener('click', () => {
    const fn = lastUndo; lastUndo = null;
    $('#toast').classList.remove('show');
    if (fn) fn();
  });

  // Keyboard shortcuts (desktop)
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'n') { e.preventDefault(); openAddDialog(); }
    if (e.key === '/') { e.preventDefault(); setView('tasks'); $('#searchInput').focus(); }
  });

  if (typeof bindSchedulerEvents === 'function') bindSchedulerEvents();
}

function init() {
  applyTheme();
  bindEvents();
  seedDemoData();
  renderAll();
  startReminderEngine();
  registerServiceWorker();
  exposeStudyFlowApp();
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./service-worker.js').catch((error) => console.info('Service worker not registered:', error.message));
  }
}

function replaceState(nextState, options = {}) {
  state = {
    ...cloneDefault(), ...(nextState || {}),
    items: Array.isArray(nextState?.items) ? nextState.items.map(normalizeItem) : [],
    dailyNotes: nextState?.dailyNotes && typeof nextState.dailyNotes === 'object' ? nextState.dailyNotes : {},
    studyPlans: Array.isArray(nextState?.studyPlans) ? nextState.studyPlans : [],
    settings: { ...DEFAULT_STATE.settings, ...(nextState?.settings || {}) }
  };
  saveState({ skipCloud: options.skipCloud });
  applyTheme(); renderAll();
}

function exposeStudyFlowApp() {
  window.StudyFlowApp = {
    getState: () => state, replaceState, saveState, renderAll,
    normalizeItem, todayISO, nowISO, showToast, escapeHTML, getCalendarUrl
  };
  window.dispatchEvent(new CustomEvent('studyflow:app-ready'));
}

document.addEventListener('DOMContentLoaded', init);
