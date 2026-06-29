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
    'not started': 'Not Started',
    'pending': 'Not Started',
    'todo': 'Not Started',
    'to do': 'Not Started',
    'in progress': 'In Progress',
    'progress': 'In Progress',
    'doing': 'In Progress',
    'done': 'Done',
    'completed': 'Done',
    'complete': 'Done'
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

function isPending(item) {
  return item.status !== 'Done';
}

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
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(value.includes('T') ? { hour: '2-digit', minute: '2-digit' } : {})
  });
}

function shortDate(value) {
  if (!value) return 'No date';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2300);
}

function setView(viewId) {
  const titles = {
    dashboard: 'Dashboard',
    tasks: 'Task Manager',
    study: 'Study Planner',
    assignments: 'Assignment Tracker',
    videos: 'Video Library',
    daily: 'Daily Tracker',
    excel: 'Excel Upload',
    scheduler: 'Smart Scheduler',
    settings: 'Settings'
  };
  $$('.view').forEach((view) => view.classList.toggle('active-view', view.id === viewId));
  $$('.nav-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === viewId));
  $$('.mobile-nav-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === viewId));
  $('#viewTitle').textContent = titles[viewId] || 'Dashboard';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme;
  $('#themeToggle').textContent = state.settings.theme === 'dark' ? '☀' : '☾';
}

function getFormItem() {
  const existingId = $('#editingId').value;
  const existing = existingId ? state.items.find((item) => item.id === existingId) : null;
  const title = cleanText($('#title').value, 120);
  if (!title) throw new Error('Please enter a task title.');

  const youtubeLink = cleanText($('#youtubeLink').value, 300);
  if (youtubeLink && !isHttpUrl(youtubeLink)) throw new Error('Video link must start with http:// or https://');

  const status = normalizeStatus($('#status').value);
  return normalizeItem({
    id: existingId || uid(),
    title,
    category: $('#category').value,
    subject: $('#subject').value,
    topic: $('#topic').value,
    youtubeLink,
    assignment: $('#assignment').value,
    dueDate: $('#dueDate').value,
    reminderAt: $('#reminderAt').value,
    priority: $('#priority').value,
    status,
    estimateMinutes: $('#estimateMinutes').value,
    notes: $('#notes').value,
    createdAt: existing?.createdAt || nowISO(),
    completedAt: status === 'Done' ? (existing?.completedAt || nowISO()) : '',
    source: existing?.source || '',
    planId: existing?.planId || '',
    scheduleKind: existing?.scheduleKind || '',
    scheduledDate: existing?.scheduledDate || $('#dueDate').value,
    subtopic: existing?.subtopic || '',
    difficulty: existing?.difficulty || '',
    revisionCount: existing?.revisionCount || 0,
    missedReason: existing?.missedReason || '',
    rescheduledDate: existing?.rescheduledDate || ''
  });
}

function resetMainForm() {
  $('#itemForm').reset();
  $('#editingId').value = '';
  $('#priority').value = 'Medium';
  $('#status').value = 'Not Started';
  $('#formTitle').textContent = 'Task details';
  $('#cancelEdit').hidden = true;
}

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
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  if (!confirm(`Delete "${item.title}"?`)) return;
  state.items = state.items.filter((entry) => entry.id !== id);
  window.StudyFlowCloudSync?.deleteTask?.(id);
  saveState();
  renderAll();
  showToast('Item deleted');
}

function editItem(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  setView('tasks');
  $('#editingId').value = item.id;
  $('#title').value = item.title;
  $('#category').value = item.category;
  $('#priority').value = item.priority;
  $('#subject').value = item.subject;
  $('#topic').value = item.topic;
  $('#youtubeLink').value = item.youtubeLink;
  $('#assignment').value = item.assignment;
  $('#dueDate').value = item.dueDate;
  $('#reminderAt').value = item.reminderAt;
  $('#status').value = item.status;
  $('#estimateMinutes').value = item.estimateMinutes;
  $('#notes').value = item.notes;
  $('#formTitle').textContent = 'Edit item';
  $('#cancelEdit').hidden = false;
  $('#title').focus();
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
    'Created from StudyFlow Planner.'
  ].filter(Boolean).join('\n');

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: item.title,
    dates: `${makeGoogleDate(start)}/${makeGoogleDate(end)}`,
    details
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
  } catch {
    return '';
  }
}

function itemCard(item, options = {}) {
  const overdue = isOverdue(item);
  const calendarUrl = getCalendarUrl(item);
  const videoLink = item.youtubeLink && isHttpUrl(item.youtubeLink)
    ? `<a class="action-btn" href="${escapeHTML(item.youtubeLink)}" target="_blank" rel="noopener">Open video</a>`
    : '';
  const calendarBtn = calendarUrl
    ? `<a class="action-btn" href="${escapeHTML(calendarUrl)}" target="_blank" rel="noopener">Google Calendar</a>`
    : '';
  const compact = options.compact ? ' compact-card' : '';
  return `
    <article class="item-card ${item.status === 'Done' ? 'done' : ''} ${overdue ? 'overdue-card' : ''}${compact}" data-id="${escapeHTML(item.id)}">
      <div class="item-top">
        <div>
          <h4 class="item-title">${escapeHTML(item.title)}</h4>
          <div class="badge-row">
            <span class="badge">${escapeHTML(item.category)}</span>
            <span class="badge priority-${item.priority.toLowerCase()}">${escapeHTML(item.priority)}</span>
            <span class="badge status-${item.status.toLowerCase().replaceAll(' ', '-')}">${escapeHTML(item.status)}</span>
            ${item.scheduleKind ? `<span class="badge">${escapeHTML(item.scheduleKind)}</span>` : ''}
            ${item.googleCalendarEventId ? '<span class="badge status-done">Calendar synced</span>' : ''}
            ${item.calendarSyncStatus === 'failed' ? '<span class="badge priority-high">Calendar failed</span>' : ''}
            ${item.syncStatus === 'pending' ? '<span class="badge priority-medium">Cloud pending</span>' : ''}
            ${overdue ? '<span class="badge priority-high">Overdue</span>' : ''}
          </div>
        </div>
        <button class="action-btn success" data-action="toggle" data-id="${escapeHTML(item.id)}" type="button">${item.status === 'Done' ? 'Undo' : 'Done'}</button>
      </div>
      <div class="meta-row">
        ${item.subject ? `<span>Subject: ${escapeHTML(item.subject)}</span>` : ''}
        ${item.topic ? `<span>Topic: ${escapeHTML(item.topic)}</span>` : ''}
        ${item.dueDate ? `<span>Due: ${escapeHTML(formatDate(item.dueDate))}</span>` : ''}
        ${item.reminderAt ? `<span>Reminder: ${escapeHTML(formatDate(item.reminderAt))}</span>` : ''}
        ${item.estimateMinutes ? `<span>${escapeHTML(item.estimateMinutes)} min</span>` : ''}
      </div>
      ${item.assignment ? `<p class="assignment-text"><strong>Assignment:</strong> ${escapeHTML(item.assignment)}</p>` : ''}
      ${item.notes && !options.compact ? `<p class="notes-text">${escapeHTML(item.notes)}</p>` : ''}
      <div class="card-actions">
        <button class="action-btn" data-action="edit" data-id="${escapeHTML(item.id)}" type="button">Edit</button>
        <button class="action-btn" data-action="progress" data-id="${escapeHTML(item.id)}" type="button">Start</button>
        ${videoLink}
        ${calendarBtn}
        <button class="action-btn" data-action="sync-calendar" data-id="${escapeHTML(item.id)}" type="button">Auto calendar</button>
        <button class="action-btn danger" data-action="delete" data-id="${escapeHTML(item.id)}" type="button">Delete</button>
      </div>
    </article>
  `;
}

function emptyState(title, text) {
  return `<div class="empty-state"><strong>${escapeHTML(title)}</strong><p>${escapeHTML(text)}</p></div>`;
}

function compactItem(item, type = 'default') {
  const link = item.youtubeLink && isHttpUrl(item.youtubeLink)
    ? `<a href="${escapeHTML(item.youtubeLink)}" target="_blank" rel="noopener">Open video</a>`
    : '';
  return `
    <article class="compact-item">
      <strong>${escapeHTML(item.title)}</strong>
      <p class="muted">${escapeHTML([item.subject, item.topic, shortDate(getItemDate(item))].filter(Boolean).join(' • '))}</p>
      ${type === 'video' ? link : ''}
      ${type === 'assignment' && item.assignment ? `<p>${escapeHTML(item.assignment)}</p>` : ''}
    </article>
  `;
}

function videoCard(item) {
  const id = getYouTubeId(item.youtubeLink);
  const thumbText = id ? '▶' : 'Video';
  return `
    <article class="video-card">
      <div class="video-thumb">${escapeHTML(thumbText)}</div>
      <h3>${escapeHTML(item.title)}</h3>
      <p class="muted">${escapeHTML([item.subject, item.topic].filter(Boolean).join(' • ') || 'Saved learning video')}</p>
      <a href="${escapeHTML(item.youtubeLink)}" target="_blank" rel="noopener">Open YouTube link</a>
    </article>
  `;
}

function getFilteredItems() {
  const search = cleanText($('#searchInput').value).toLowerCase();
  const status = $('#statusFilter').value;
  const category = $('#categoryFilter').value;
  const dateFilter = $('#dateFilter').value;

  return state.items.filter((item) => {
    const haystack = [item.title, item.subject, item.topic, item.assignment, item.notes].join(' ').toLowerCase();
    if (search && !haystack.includes(search)) return false;
    if (status !== 'all' && item.status !== status) return false;
    if (category !== 'all' && item.category !== category) return false;
    if (dateFilter === 'today' && !isDueToday(item)) return false;
    if (dateFilter === 'week' && !isWithinNextDays(item, 7)) return false;
    if (dateFilter === 'overdue' && !isOverdue(item)) return false;
    if (dateFilter === 'noDate' && getItemDate(item)) return false;
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
  const mode = $('#todaySort').value;
  const copy = [...items];
  if (mode === 'priority') return copy.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  if (mode === 'time') return copy.sort((a, b) => (a.reminderAt || '9999').localeCompare(b.reminderAt || '9999'));
  return copy.sort(sortSmart);
}

function calculateTodayProgress() {
  const todayItems = state.items.filter((item) => isDueToday(item) || isOverdue(item));
  if (!todayItems.length) return 0;
  const done = todayItems.filter((item) => item.status === 'Done').length;
  return Math.round((done / todayItems.length) * 100);
}

function calculateStudyProgress() {
  const study = state.items.filter((item) => item.category === 'Study');
  if (!study.length) return 0;
  return Math.round((study.filter((item) => item.status === 'Done').length / study.length) * 100);
}

function renderDashboard() {
  const today = todayISO();
  const todayItems = sortTodayItems(state.items.filter((item) => isDueToday(item) || isOverdue(item)));
  const pending = state.items.filter(isPending);
  const overdue = state.items.filter(isOverdue);
  const completedToday = state.items.filter((item) => item.completedAt && item.completedAt.slice(0, 10) === today);
  const assignments = state.items.filter((item) => item.category === 'Assignment' || item.assignment);

  $('#todayCount').textContent = state.items.filter(isDueToday).length;
  $('#overdueCount').textContent = overdue.length;
  $('#pendingCount').textContent = pending.length;
  $('#completedTodayCount').textContent = completedToday.length;
  const calendarPending = state.items.filter((item) => item.status !== 'Done' && (item.reminderAt || item.dueDate) && item.calendarSyncStatus !== 'synced').length;
  const dashboardSync = $('#dashboardSyncStatus');
  if (dashboardSync) {
    const user = window.StudyFlowCloudSync?.getUser?.();
    dashboardSync.innerHTML = `
      <strong>${escapeHTML(user ? 'Cloud sync active' : 'Local mode')}</strong>
      <p class="muted">${escapeHTML(user ? 'Your signed-in data can sync across devices.' : 'Sign in from Settings to access the same data on laptop and phone.')}</p>
      <span class="pill">${calendarPending} calendar pending</span>
    `;
  }

  const progress = calculateTodayProgress();
  $('#sidebarProgressBar').style.width = `${progress}%`;
  $('#sidebarProgressText').textContent = `${progress}% complete`;

  $('#todayHeadline').textContent = todayItems.length
    ? `${todayItems.length} item${todayItems.length > 1 ? 's' : ''} need your attention today`
    : 'Your day is clear';
  $('#todaySubtext').textContent = todayItems.length
    ? 'Finish overdue work first, then complete today’s study topics and assignments.'
    : 'Add a task or study topic to start planning your day.';

  $('#todayList').innerHTML = todayItems.length
    ? todayItems.map((item) => itemCard(item)).join('')
    : emptyState('No work due today', 'Add study topics, assignments, or reminders to build your daily plan.');

  const videos = state.items.filter((item) => item.youtubeLink && isPending(item)).sort(sortSmart).slice(0, 4);
  $('#nextVideos').innerHTML = videos.length
    ? videos.map((item) => compactItem(item, 'video')).join('')
    : emptyState('No videos saved', 'Add YouTube links inside study topics.');

  const upcomingAssignments = assignments.filter(isPending).sort(sortSmart).slice(0, 4);
  $('#upcomingAssignments').innerHTML = upcomingAssignments.length
    ? upcomingAssignments.map((item) => compactItem(item, 'assignment')).join('')
    : emptyState('No assignments pending', 'Add assignments to track deadlines clearly.');

  const studyProgress = calculateStudyProgress();
  const ring = $('#studyProgressRing');
  ring.style.background = `conic-gradient(var(--primary) ${studyProgress * 3.6}deg, var(--border-soft) 0deg)`;
  ring.dataset.value = `${studyProgress}%`;
  $('#studyProgressText').textContent = `${studyProgress}%`;
}

function renderTasks() {
  const items = getFilteredItems();
  $('#resultCount').textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
  $('#allItems').innerHTML = items.length
    ? items.map((item) => itemCard(item)).join('')
    : emptyState('No matching items', 'Try changing filters or add a new task.');

  const statuses = ['Not Started', 'In Progress', 'Done'];
  $('#boardItems').innerHTML = statuses.map((status) => {
    const columnItems = items.filter((item) => item.status === status);
    return `
      <section class="board-column">
        <h4>${escapeHTML(status)} <span class="pill">${columnItems.length}</span></h4>
        <div class="card-list">
          ${columnItems.length ? columnItems.map((item) => itemCard(item, { compact: true })).join('') : emptyState('Nothing here', 'Move or add tasks.')}
        </div>
      </section>
    `;
  }).join('');

  $('#allItems').hidden = Boolean(state.settings.boardView);
  $('#boardItems').hidden = !state.settings.boardView;
  $('#listViewBtn').classList.toggle('active', !state.settings.boardView);
  $('#boardViewBtn').classList.toggle('active', Boolean(state.settings.boardView));
}

function renderStudy() {
  const study = state.items.filter((item) => item.category === 'Study').sort(sortSmart);
  $('#studyCount').textContent = study.length;
  $('#studyList').innerHTML = study.length
    ? study.map((item) => itemCard(item)).join('')
    : emptyState('No study topics yet', 'Add subject, topic, video, assignment, and due date.');
}

function renderAssignments() {
  const items = state.items.filter((item) => item.category === 'Assignment' || item.assignment).sort(sortSmart);
  $('#assignmentList').innerHTML = items.length
    ? items.map((item) => itemCard(item)).join('')
    : emptyState('No assignments yet', 'Add assignment details in Task Manager or Study Planner.');
}

function renderVideos() {
  const videos = state.items.filter((item) => item.youtubeLink && isHttpUrl(item.youtubeLink)).sort(sortSmart);
  $('#videoList').innerHTML = videos.length
    ? videos.map(videoCard).join('')
    : emptyState('No video links yet', 'Save YouTube links with your study topics.');
}

function renderDaily() {
  const selectedDate = $('#dailyDate').value || todayISO();
  $('#dailyDate').value = selectedDate;
  $('#dailyNote').value = state.dailyNotes[selectedDate] || '';

  const items = state.items.filter((item) => item.dueDate === selectedDate || getDatePart(item.reminderAt) === selectedDate).sort(sortSmart);
  const done = items.filter((item) => item.status === 'Done').length;
  const score = items.length ? Math.round((done / items.length) * 100) : 0;
  $('#dailyScore').textContent = `${score}%`;
  $('#dailyChecklist').innerHTML = items.length
    ? items.map((item) => itemCard(item)).join('')
    : emptyState('No checklist for this date', 'Add due dates or reminders to see daily tasks here.');
}

function renderAll() {
  const dateText = new Date(`${todayISO()}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  });
  $('#currentDate').textContent = dateText;
  renderDashboard();
  renderTasks();
  renderStudy();
  if (typeof renderScheduler === 'function') renderScheduler();
  renderAssignments();
  renderVideos();
  renderDaily();
}

function createStudyItemFromForm() {
  const subject = cleanText($('#studySubject').value, 80);
  const topic = cleanText($('#studyTopic').value, 120);
  if (!subject || !topic) throw new Error('Subject and topic are required.');
  const youtubeLink = cleanText($('#studyVideo').value, 300);
  if (youtubeLink && !isHttpUrl(youtubeLink)) throw new Error('Video link must start with http:// or https://');
  return normalizeItem({
    title: `${subject}: ${topic}`,
    category: 'Study',
    subject,
    topic,
    youtubeLink,
    assignment: $('#studyAssignment').value,
    dueDate: $('#studyDueDate').value,
    reminderAt: $('#studyReminderAt').value,
    priority: $('#studyPriority').value,
    estimateMinutes: $('#studyEstimateMinutes').value,
    status: 'Not Started',
    notes: $('#studyNotes').value
  });
}

function buildQuickItem() {
  const title = cleanText($('#quickTitle').value, 120);
  if (!title) throw new Error('Please enter a task title.');
  return normalizeItem({
    title,
    category: $('#quickCategory').value,
    dueDate: $('#quickDueDate').value,
    reminderAt: $('#quickReminderAt').value,
    priority: $('#quickPriority').value,
    status: 'Not Started'
  });
}

function handleItemAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const id = button.dataset.id;
  const action = button.dataset.action;
  if (action === 'edit') editItem(id);
  if (action === 'delete') deleteItem(id);
  if (action === 'toggle') toggleDone(id);
  if (action === 'progress') updateStatus(id, 'In Progress');
  if (action === 'sync-calendar') window.StudyFlowCalendar?.createOrUpdateEvent?.(id);
}

function renderExcelPreview(rows, errors = []) {
  pendingImportRows = rows;
  $('#importRows').disabled = rows.length === 0;
  $('#clearPreview').disabled = rows.length === 0 && errors.length === 0;
  $('#importSummary').hidden = false;
  $('#importSummary').innerHTML = `${rows.length} valid row${rows.length === 1 ? '' : 's'} ready. ${errors.length ? `${errors.length} row${errors.length === 1 ? '' : 's'} skipped because title was missing.` : ''}`;

  if (!rows.length) {
    $('#excelPreview').innerHTML = emptyState('No valid rows found', 'Check that your file contains the Task Title column.');
    return;
  }

  const header = TEMPLATE_COLUMNS.map((col) => `<th>${escapeHTML(col)}</th>`).join('');
  const body = rows.slice(0, 25).map((item) => `
    <tr>
      <td>${escapeHTML(item.title)}</td>
      <td>${escapeHTML(item.category)}</td>
      <td>${escapeHTML(item.subject)}</td>
      <td>${escapeHTML(item.topic)}</td>
      <td>${escapeHTML(item.youtubeLink)}</td>
      <td>${escapeHTML(item.assignment)}</td>
      <td>${escapeHTML(item.dueDate)}</td>
      <td>${escapeHTML(item.reminderAt)}</td>
      <td>${escapeHTML(item.priority)}</td>
      <td>${escapeHTML(item.status)}</td>
      <td>${escapeHTML(item.estimateMinutes)}</td>
      <td>${escapeHTML(item.notes)}</td>
    </tr>
  `).join('');

  $('#excelPreview').innerHTML = `
    <table class="preview-table">
      <thead><tr>${header}</tr></thead>
      <tbody>${body}</tbody>
    </table>
    ${rows.length > 25 ? `<p class="muted">Showing first 25 of ${rows.length} rows.</p>` : ''}
  `;
}

function handleExcelFile(file) {
  if (!file) return;
  if (!window.XLSX) {
    showToast('SheetJS library not loaded. Connect internet and reload once for Excel upload.');
    return;
  }
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
          category: row.Category,
          subject: row.Subject,
          topic: row.Topic,
          youtubeLink: row['YouTube Link'] || row.Video || row['Video Link'],
          assignment: row.Assignment,
          dueDate: row['Due Date'],
          reminderAt: row['Reminder Date Time'] || row.Reminder,
          priority: row.Priority,
          status: row.Status,
          estimateMinutes: row['Estimated Minutes'],
          notes: row.Notes
        });
        if (!item.title) errors.push(index + 2);
        else rows.push(item);
      });

      renderExcelPreview(rows, errors);
      showToast('Excel preview ready');
    } catch (error) {
      console.error(error);
      showToast('Could not read this Excel file. Please check the format.');
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
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportBackup() {
  const content = JSON.stringify(state, null, 2);
  downloadBlob(content, `studyflow_backup_${todayISO()}.json`, 'application/json');
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
        ...cloneDefault(),
        ...imported,
        items: imported.items.map(normalizeItem),
        dailyNotes: imported.dailyNotes || {},
        studyPlans: Array.isArray(imported.studyPlans) ? imported.studyPlans : [],
        settings: { ...DEFAULT_STATE.settings, ...(imported.settings || {}) }
      };
      saveState();
      applyTheme();
      renderAll();
      showToast('Backup imported');
    } catch (error) {
      console.error(error);
      showToast('Invalid backup file');
    }
  };
  reader.readAsText(file);
}

function openFocusMode() {
  const item = state.items.filter(isPending).sort(sortSmart)[0];
  const dialog = $('#focusDialog');
  if (!item) {
    $('#focusContent').innerHTML = emptyState('Nothing pending', 'You have no pending tasks right now.');
  } else {
    $('#focusContent').innerHTML = `
      <div class="focus-card">
        <span class="badge priority-${item.priority.toLowerCase()}">${escapeHTML(item.priority)}</span>
        <h4>${escapeHTML(item.title)}</h4>
        <p class="muted">${escapeHTML([item.subject, item.topic, item.dueDate ? `Due ${formatDate(item.dueDate)}` : ''].filter(Boolean).join(' • '))}</p>
        ${item.assignment ? `<p class="assignment-text">${escapeHTML(item.assignment)}</p>` : ''}
        <div class="form-actions" style="justify-content:center;margin-top:14px;">
          <button class="primary-btn" data-action="toggle" data-id="${escapeHTML(item.id)}" type="button">Mark done</button>
          <button class="soft-btn" data-action="progress" data-id="${escapeHTML(item.id)}" type="button">Start</button>
        </div>
      </div>
    `;
  }
  if (typeof dialog.showModal === 'function') dialog.showModal();
}

function seedDemoData() {
  // Demo data is now opt-in so a fresh phone/laptop does not accidentally mix sample tasks with cloud data.
  if (!new URLSearchParams(location.search).has('demo')) return;
  if (state.items.length) return;
  const today = todayISO();
  state.items = [
    normalizeItem({
      title: 'Watch SQL Joins video', category: 'Study', subject: 'SQL', topic: 'Joins',
      youtubeLink: 'https://www.youtube.com/', assignment: 'Practice 10 join questions', dueDate: today,
      reminderAt: `${today}T19:00`, priority: 'High', status: 'Not Started', estimateMinutes: 45,
      notes: 'Focus on INNER JOIN, LEFT JOIN, and RIGHT JOIN.'
    }),
    normalizeItem({
      title: 'Complete Power BI assignment', category: 'Assignment', subject: 'Power BI', topic: 'DAX',
      assignment: 'Create 3 measures and test output', dueDate: today, priority: 'Medium', status: 'In Progress', estimateMinutes: 60
    }),
    normalizeItem({
      title: 'English speaking practice', category: 'Task', subject: 'English', topic: 'Intro practice',
      dueDate: today, priority: 'Low', status: 'Not Started', estimateMinutes: 20
    })
  ];
  saveState();
}

function bindEvents() {
  $$('.nav-btn, .mobile-nav-btn').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.view)));
  $$('[data-jump]').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.jump)));

  $('#themeToggle').addEventListener('click', () => {
    state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    saveState();
    applyTheme();
  });

  $('#itemForm').addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      saveItem(getFormItem());
      resetMainForm();
      showToast('Item saved');
    } catch (error) {
      showToast(error.message);
    }
  });

  $('#resetForm').addEventListener('click', resetMainForm);
  $('#cancelEdit').addEventListener('click', resetMainForm);

  $('#studyForm').addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      saveItem(createStudyItemFromForm());
      $('#studyForm').reset();
      $('#studyPriority').value = 'Medium';
      showToast('Study topic added');
    } catch (error) {
      showToast(error.message);
    }
  });

  $('#quickAddBtn').addEventListener('click', () => {
    const dialog = $('#quickAddDialog');
    $('#quickTitle').focus();
    if (typeof dialog.showModal === 'function') dialog.showModal();
  });

  $('#closeQuickAdd').addEventListener('click', () => $('#quickAddDialog').close());

  $('#quickAddForm').addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      saveItem(buildQuickItem());
      $('#quickAddForm').reset();
      $('#quickPriority').value = 'Medium';
      $('#quickAddDialog').close();
      showToast('Quick task added');
    } catch (error) {
      showToast(error.message);
    }
  });

  $('#focusModeBtn').addEventListener('click', openFocusMode);
  $('#closeFocus').addEventListener('click', () => $('#focusDialog').close());

  document.body.addEventListener('click', handleItemAction);

  ['searchInput', 'statusFilter', 'categoryFilter', 'dateFilter', 'todaySort'].forEach((id) => {
    $(`#${id}`).addEventListener('input', renderAll);
    $(`#${id}`).addEventListener('change', renderAll);
  });

  $('#listViewBtn').addEventListener('click', () => {
    state.settings.boardView = false;
    saveState();
    renderTasks();
  });

  $('#boardViewBtn').addEventListener('click', () => {
    state.settings.boardView = true;
    saveState();
    renderTasks();
  });

  $('#dailyDate').addEventListener('change', renderDaily);
  $('#saveDailyNote').addEventListener('click', () => {
    const date = $('#dailyDate').value || todayISO();
    state.dailyNotes[date] = cleanText($('#dailyNote').value, 1500);
    saveState();
    showToast('Daily note saved');
  });

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
    saveState();
    clearExcelPreview();
    renderAll();
    showToast('Rows imported successfully');
  });

  const dropZone = $('#dropZone');
  ['dragenter', 'dragover'].forEach((type) => dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach((type) => dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
  }));
  dropZone.addEventListener('drop', (event) => handleExcelFile(event.dataTransfer.files[0]));

  $('#exportBackup').addEventListener('click', exportBackup);
  $('#importBackup').addEventListener('change', (event) => importBackup(event.target.files[0]));
  $('#clearCompleted').addEventListener('click', () => {
    if (!confirm('Clear all completed items?')) return;
    const deletedIds = state.items.filter((item) => item.status === 'Done').map((item) => item.id);
    state.items = state.items.filter((item) => item.status !== 'Done');
    window.StudyFlowCloudSync?.deleteTasks?.(deletedIds);
    saveState();
    renderAll();
    showToast('Completed items cleared');
  });
  $('#deleteAll').addEventListener('click', () => {
    if (!confirm('Delete all tasks, study items, and notes?')) return;
    state = cloneDefault();
    window.StudyFlowCloudSync?.deleteAllCloudTasks?.();
    saveState();
    applyTheme();
    renderAll();
    showToast('All data deleted');
  });

  if (typeof bindSchedulerEvents === 'function') bindSchedulerEvents();
}

function init() {
  applyTheme();
  $('#dailyDate').value = todayISO();
  bindEvents();
  seedDemoData();
  renderAll();
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
    ...cloneDefault(),
    ...(nextState || {}),
    items: Array.isArray(nextState?.items) ? nextState.items.map(normalizeItem) : [],
    dailyNotes: nextState?.dailyNotes && typeof nextState.dailyNotes === 'object' ? nextState.dailyNotes : {},
    studyPlans: Array.isArray(nextState?.studyPlans) ? nextState.studyPlans : [],
    settings: { ...DEFAULT_STATE.settings, ...(nextState?.settings || {}) }
  };
  saveState({ skipCloud: options.skipCloud });
  applyTheme();
  renderAll();
}

function exposeStudyFlowApp() {
  window.StudyFlowApp = {
    getState: () => state,
    replaceState,
    saveState,
    renderAll,
    normalizeItem,
    todayISO,
    nowISO,
    showToast,
    escapeHTML,
    getCalendarUrl
  };
  window.dispatchEvent(new CustomEvent('studyflow:app-ready'));
}

document.addEventListener('DOMContentLoaded', init);
