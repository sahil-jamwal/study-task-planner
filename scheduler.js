'use strict';

// Smart Scheduler module
// This file adds a free, rule-based syllabus-to-schedule generator.
// It does not use paid APIs and it does not change existing tasks unless the user saves the preview.

let schedulerPreview = null;
let schedulerEventsBound = false;

function schedulerElement(id) {
  return document.getElementById(id);
}

function dateToISO(date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function addDaysISO(iso, days) {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return dateToISO(date);
}

function diffDaysISO(fromISO, toISO) {
  const from = new Date(`${fromISO}T00:00:00`);
  const to = new Date(`${toISO}T00:00:00`);
  return Math.round((to - from) / 86400000);
}

function normalizeDifficulty(value) {
  const text = cleanText(value, 20).toLowerCase();
  if (['hard', 'difficult', 'high'].includes(text)) return 'Hard';
  if (['easy', 'simple', 'low'].includes(text)) return 'Easy';
  return 'Medium';
}

function defaultMinutesForDifficulty(difficulty) {
  return { Easy: 35, Medium: 50, Hard: 75 }[difficulty] || 50;
}

function topicSortScore(topic) {
  const priorityScore = { High: 30, Medium: 20, Low: 10 }[topic.priority] || 20;
  const difficultyScore = { Hard: 12, Medium: 8, Easy: 4 }[topic.difficulty] || 8;
  return priorityScore + difficultyScore + Math.min(topic.estimatedMinutes / 20, 8);
}

function getSelectedPreferredDays() {
  const checked = Array.from(document.querySelectorAll('input[name="preferredDay"]:checked'));
  return checked.map((input) => Number(input.value));
}

function parseSchedulerTopics(rawText) {
  return rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split('|').map((part) => part.trim());
      const topicName = cleanText(parts[0], 120);
      const difficulty = normalizeDifficulty(parts[1] || 'Medium');
      const priority = normalizePriority(parts[2] || 'Medium');
      const minutes = normalizeMinutes(parts[3] || defaultMinutesForDifficulty(difficulty));
      const youtubeLink = cleanText(parts[4] || '', 300);
      const assignment = cleanText(parts[5] || '', 180);

      return {
        id: `topic_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
        topic: topicName,
        difficulty,
        priority,
        estimatedMinutes: minutes || defaultMinutesForDifficulty(difficulty),
        youtubeLink: isHttpUrl(youtubeLink) ? youtubeLink : '',
        assignment,
        order: index + 1
      };
    })
    .filter((topic) => topic.topic);
}

function getSchedulerFormData() {
  const subject = cleanText(schedulerElement('schedulerSubject').value, 80);
  const examDate = normalizeDate(schedulerElement('schedulerExamDate').value);
  const availableDays = Number(schedulerElement('schedulerDays').value);
  const dailyHours = Number(schedulerElement('schedulerDailyHours').value);
  const revision = schedulerElement('schedulerRevision').value;
  const reminderTime = schedulerElement('schedulerReminderTime').value || '19:00';
  const bufferLevel = schedulerElement('schedulerBufferLevel').value || 'normal';
  const preferredDays = getSelectedPreferredDays();
  const topics = parseSchedulerTopics(schedulerElement('schedulerTopics').value);
  const today = todayISO();

  if (!subject) throw new Error('Please enter course or subject name.');
  if (!topics.length) throw new Error('Please enter at least one syllabus topic.');
  if (!Number.isFinite(dailyHours) || dailyHours < 0.5) throw new Error('Daily study hours must be at least 0.5 hour.');
  if (!preferredDays.length) throw new Error('Please select at least one preferred study day.');
  if (!examDate && (!Number.isFinite(availableDays) || availableDays < 1)) {
    throw new Error('Please enter exam date or number of available study days.');
  }
  if (examDate && examDate <= today) throw new Error('Exam date must be after today.');

  return {
    subject,
    examDate,
    availableDays: Number.isFinite(availableDays) ? Math.min(Math.max(Math.round(availableDays), 1), 365) : 0,
    dailyMinutes: Math.round(dailyHours * 60),
    revision,
    reminderTime,
    bufferLevel,
    preferredDays,
    topics,
    today
  };
}

function buildAvailableDates(config) {
  const dates = [];
  let cursor = config.today;
  let guard = 0;

  if (config.examDate) {
    while (cursor < config.examDate && guard < 370) {
      const day = new Date(`${cursor}T00:00:00`).getDay();
      if (config.preferredDays.includes(day)) dates.push(cursor);
      cursor = addDaysISO(cursor, 1);
      guard += 1;
    }
    return dates;
  }

  while (dates.length < config.availableDays && guard < 740) {
    const day = new Date(`${cursor}T00:00:00`).getDay();
    if (config.preferredDays.includes(day)) dates.push(cursor);
    cursor = addDaysISO(cursor, 1);
    guard += 1;
  }
  return dates;
}

function bufferDayCount(totalDays, level) {
  if (totalDays < 5) return 0;
  const ratio = { light: 0.08, normal: 0.12, heavy: 0.18 }[level] || 0.12;
  return Math.max(1, Math.floor(totalDays * ratio));
}

function revisionInterval(revision) {
  if (revision === 'every3') return 3;
  if (revision === 'weekly') return 7;
  return 0;
}

function createDayObjects(dates, config) {
  const bufferCount = bufferDayCount(dates.length, config.bufferLevel);
  const bufferIndexes = new Set();
  for (let i = 0; i < bufferCount; i += 1) {
    bufferIndexes.add(Math.max(0, dates.length - 1 - i));
  }

  const interval = revisionInterval(config.revision);

  return dates.map((date, index) => {
    const isBuffer = bufferIndexes.has(index);
    const isRevision = interval > 0 && index > 0 && (index + 1) % interval === 0;
    const reservedRevisionMinutes = isRevision && !isBuffer ? Math.min(45, Math.floor(config.dailyMinutes * 0.35)) : 0;

    return {
      dayNumber: index + 1,
      date,
      capacity: config.dailyMinutes,
      remaining: isBuffer ? 0 : Math.max(0, config.dailyMinutes - reservedRevisionMinutes),
      isBuffer,
      isRevision,
      reservedRevisionMinutes,
      tasks: []
    };
  });
}

function splitLargeTopic(topic, dailyMinutes) {
  const safeDaily = Math.max(30, dailyMinutes);
  if (topic.estimatedMinutes <= safeDaily) return [topic];

  const parts = [];
  let remaining = topic.estimatedMinutes;
  let part = 1;
  const maxChunk = Math.max(30, Math.floor(safeDaily * 0.85));

  while (remaining > 0) {
    const chunk = Math.min(maxChunk, remaining);
    parts.push({
      ...topic,
      id: `${topic.id}_part_${part}`,
      topic: `${topic.topic} - Part ${part}`,
      estimatedMinutes: chunk,
      parentTopic: topic.topic
    });
    remaining -= chunk;
    part += 1;
  }
  return parts;
}

function placeTaskOnDay(days, task, startIndex = 0) {
  for (let i = startIndex; i < days.length; i += 1) {
    if (days[i].remaining >= task.estimatedMinutes) {
      days[i].tasks.push(task);
      days[i].remaining -= task.estimatedMinutes;
      return i;
    }
  }
  return -1;
}

function addAssignmentTasks(days, studyPlacements, config) {
  studyPlacements.forEach((placement) => {
    const topic = placement.topic;
    if (!topic.assignment) return;
    const assignmentTask = {
      id: `${topic.id}_assignment`,
      type: 'Assignment',
      topic: topic.parentTopic || topic.topic,
      title: `Practice: ${topic.parentTopic || topic.topic}`,
      difficulty: topic.difficulty,
      priority: topic.priority,
      estimatedMinutes: Math.min(45, Math.max(25, Math.floor(topic.estimatedMinutes * 0.45))),
      youtubeLink: '',
      assignment: topic.assignment,
      sourceTopicId: topic.id
    };
    const preferredStart = Math.min(placement.dayIndex + 1, days.length - 1);
    const placed = placeTaskOnDay(days, assignmentTask, preferredStart);
    if (placed < 0) placeTaskOnDay(days, assignmentTask, placement.dayIndex);
  });
}

function addRevisionTasks(days, studyPlacements) {
  days.forEach((day, dayIndex) => {
    if (!day.isRevision || day.isBuffer) return;
    const earlier = studyPlacements
      .filter((placement) => placement.dayIndex < dayIndex)
      .slice(-4)
      .map((placement) => placement.topic.parentTopic || placement.topic.topic);

    const uniqueTopics = Array.from(new Set(earlier)).slice(-3);
    if (!uniqueTopics.length) return;

    day.tasks.push({
      id: `revision_${day.date}_${dayIndex}`,
      type: 'Revision',
      topic: uniqueTopics.join(', '),
      title: `Revision: ${uniqueTopics.join(', ')}`,
      difficulty: 'Medium',
      priority: 'High',
      estimatedMinutes: day.reservedRevisionMinutes || 30,
      youtubeLink: '',
      assignment: `Revise key notes and solve quick questions for: ${uniqueTopics.join(', ')}`
    });
  });
}

function addBufferTasks(days, config) {
  days.forEach((day) => {
    if (!day.isBuffer) return;
    day.tasks.push({
      id: `buffer_${day.date}`,
      type: 'Buffer',
      topic: 'Catch-up and practice',
      title: `Buffer day: ${config.subject} catch-up`,
      difficulty: 'Medium',
      priority: 'Medium',
      estimatedMinutes: Math.min(config.dailyMinutes, 90),
      youtubeLink: '',
      assignment: 'Use this day for missed topics, revision, pending videos, or practice questions.'
    });
  });
}

function makeSchedule(config) {
  const warnings = [];
  const dates = buildAvailableDates(config);
  if (!dates.length) throw new Error('No study dates found. Check exam date and preferred study days.');

  const days = createDayObjects(dates, config);
  const sortedTopics = [...config.topics].sort((a, b) => topicSortScore(b) - topicSortScore(a));
  const topicPieces = sortedTopics.flatMap((topic) => splitLargeTopic(topic, config.dailyMinutes));
  const studyPlacements = [];
  const unplanned = [];

  topicPieces.forEach((topic) => {
    const task = { ...topic, type: 'Study', title: topic.topic };
    const placedDay = placeTaskOnDay(days, task);
    if (placedDay >= 0) studyPlacements.push({ topic, dayIndex: placedDay });
    else unplanned.push(topic);
  });

  addAssignmentTasks(days, studyPlacements, config);
  addRevisionTasks(days, studyPlacements);
  addBufferTasks(days, config);

  const totalTopicMinutes = config.topics.reduce((sum, topic) => sum + topic.estimatedMinutes, 0);
  const totalCapacity = dates.length * config.dailyMinutes;
  const plannedMinutes = days.reduce((sum, day) => sum + day.tasks.reduce((taskSum, task) => taskSum + Number(task.estimatedMinutes || 0), 0), 0);
  const workloadRatio = totalCapacity ? Math.round((plannedMinutes / totalCapacity) * 100) : 0;

  if (unplanned.length) {
    warnings.push(`${unplanned.length} topic part${unplanned.length > 1 ? 's' : ''} could not fit. Increase days or daily study hours.`);
  }
  if (workloadRatio > 90) warnings.push('Plan is very tight. Keep more buffer or increase daily hours.');
  if (dates.length < 7 && config.topics.length > 8) warnings.push('Too many topics for very few days. The plan may feel heavy.');
  if (config.examDate && diffDaysISO(config.today, config.examDate) <= 3) warnings.push('Exam is very close. Prioritize high-priority topics first.');

  return {
    id: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    subject: config.subject,
    createdAt: nowISO(),
    examDate: config.examDate,
    dailyMinutes: config.dailyMinutes,
    revision: config.revision,
    bufferLevel: config.bufferLevel,
    reminderTime: config.reminderTime,
    dates,
    days,
    topics: config.topics,
    unplanned,
    warnings,
    stats: {
      totalDays: dates.length,
      totalTopics: config.topics.length,
      totalTopicMinutes,
      plannedMinutes,
      totalCapacity,
      workloadRatio
    }
  };
}

function scheduleTaskToItem(plan, day, task) {
  const isAssignment = task.type === 'Assignment';
  const isBuffer = task.type === 'Buffer';
  const category = isAssignment ? 'Assignment' : (isBuffer ? 'Task' : 'Study');
  const reminderAt = plan.reminderTime ? `${day.date}T${plan.reminderTime}` : '';

  return normalizeItem({
    id: uid(),
    title: task.type === 'Study' ? `${plan.subject}: ${task.title}` : task.title,
    category,
    subject: plan.subject,
    topic: task.topic || task.title,
    subtopic: task.parentTopic || '',
    youtubeLink: task.youtubeLink,
    assignment: task.assignment,
    dueDate: day.date,
    scheduledDate: day.date,
    reminderAt,
    priority: task.priority,
    status: 'Not Started',
    estimateMinutes: task.estimatedMinutes,
    notes: `Generated by Smart Scheduler. Type: ${task.type}. Difficulty: ${task.difficulty}. Day ${day.dayNumber}.`,
    createdAt: nowISO(),
    source: 'smart-scheduler',
    planId: plan.id,
    scheduleKind: task.type,
    difficulty: task.difficulty
  });
}

function flattenPlanItems(plan) {
  return plan.days.flatMap((day) => day.tasks.map((task) => scheduleTaskToItem(plan, day, task)));
}

function workloadClass(day) {
  const used = day.tasks.reduce((sum, task) => sum + Number(task.estimatedMinutes || 0), 0);
  const ratio = day.capacity ? used / day.capacity : 0;
  if (ratio >= 0.95) return 'high-load';
  if (ratio >= 0.7) return 'medium-load';
  return 'low-load';
}

function renderSchedulePreview(plan) {
  schedulerPreview = plan;
  const summary = schedulerElement('scheduleSummary');
  const warnings = schedulerElement('scheduleWarnings');
  const preview = schedulerElement('schedulePreview');
  const calendar = schedulerElement('scheduleCalendarView');
  const saveButton = schedulerElement('saveGeneratedPlan');
  const clearButton = schedulerElement('clearGeneratedPlan');

  summary.innerHTML = `
    <div class="scheduler-stat"><strong>${plan.stats.totalDays}</strong><span>Study days</span></div>
    <div class="scheduler-stat"><strong>${plan.stats.totalTopics}</strong><span>Topics</span></div>
    <div class="scheduler-stat"><strong>${Math.round(plan.stats.plannedMinutes / 60)}h</strong><span>Planned work</span></div>
    <div class="scheduler-stat"><strong>${plan.stats.workloadRatio}%</strong><span>Capacity used</span></div>
  `;

  warnings.hidden = plan.warnings.length === 0;
  warnings.innerHTML = plan.warnings.map((warning) => `<p>⚠ ${escapeHTML(warning)}</p>`).join('');

  preview.innerHTML = plan.days.map((day) => {
    const used = day.tasks.reduce((sum, task) => sum + Number(task.estimatedMinutes || 0), 0);
    const percent = day.capacity ? Math.min(100, Math.round((used / day.capacity) * 100)) : 0;
    const taskCards = day.tasks.map((task) => `
      <article class="schedule-task ${escapeHTML(task.type.toLowerCase())}">
        <div>
          <strong>${escapeHTML(task.title)}</strong>
          <p class="muted">${escapeHTML(task.type)} • ${escapeHTML(task.difficulty)} • ${escapeHTML(task.priority)} • ${escapeHTML(task.estimatedMinutes)} min</p>
          ${task.assignment ? `<p class="assignment-text">${escapeHTML(task.assignment)}</p>` : ''}
          ${task.youtubeLink ? `<a href="${escapeHTML(task.youtubeLink)}" target="_blank" rel="noopener">Open video</a>` : ''}
        </div>
      </article>
    `).join('');

    return `
      <section class="schedule-day ${workloadClass(day)}">
        <div class="schedule-day-head">
          <div>
            <p class="eyebrow">Day ${day.dayNumber}</p>
            <h4>${escapeHTML(formatDate(day.date))}</h4>
          </div>
          <span class="pill">${used}/${day.capacity} min</span>
        </div>
        <div class="workload-bar"><span style="width:${percent}%"></span></div>
        ${day.isBuffer ? '<p class="muted">Buffer day is reserved for catch-up and practice.</p>' : ''}
        ${taskCards || emptyState('No planned task', 'This day is free or reserved.')}
      </section>
    `;
  }).join('');

  calendar.innerHTML = plan.days.map((day) => {
    const count = day.tasks.length;
    const labels = day.tasks.slice(0, 3).map((task) => `<span>${escapeHTML(task.type)}</span>`).join('');
    return `
      <article class="calendar-day-card">
        <strong>${escapeHTML(shortDate(day.date))}</strong>
        <p>${count} item${count === 1 ? '' : 's'}</p>
        <div>${labels}</div>
      </article>
    `;
  }).join('');

  saveButton.disabled = false;
  clearButton.disabled = false;
}

function clearSchedulerPreview() {
  schedulerPreview = null;
  schedulerElement('scheduleSummary').innerHTML = '';
  schedulerElement('scheduleWarnings').hidden = true;
  schedulerElement('scheduleWarnings').innerHTML = '';
  schedulerElement('schedulePreview').innerHTML = emptyState('No schedule generated yet', 'Paste syllabus topics and click Generate schedule.');
  schedulerElement('scheduleCalendarView').innerHTML = emptyState('No calendar preview yet', 'Generate a plan to see date-wise workload.');
  schedulerElement('saveGeneratedPlan').disabled = true;
  schedulerElement('clearGeneratedPlan').disabled = true;
}

function saveGeneratedPlan() {
  if (!schedulerPreview) return;
  const items = flattenPlanItems(schedulerPreview).map((item) => normalizeItem({
    ...item,
    updatedAt: nowISO(),
    deviceCreatedFrom: navigator.userAgent.slice(0, 120),
    syncStatus: window.StudyFlowCloudSync?.getUser?.() ? 'pending' : 'local',
    calendarSyncStatus: 'not_synced'
  }));
  state.items = [...items, ...state.items];
  state.studyPlans = Array.isArray(state.studyPlans) ? state.studyPlans : [];
  state.studyPlans.unshift({
    id: schedulerPreview.id,
    subject: schedulerPreview.subject,
    createdAt: schedulerPreview.createdAt,
    examDate: schedulerPreview.examDate,
    totalDays: schedulerPreview.stats.totalDays,
    totalTopics: schedulerPreview.stats.totalTopics,
    plannedItems: items.length,
    dailyMinutes: schedulerPreview.dailyMinutes
  });
  saveState();
  clearSchedulerPreview();
  renderAll();
  showToast(`${items.length} scheduled items added to your planner`);
  setView('dashboard');
}

function loadSampleSyllabus() {
  schedulerElement('schedulerSubject').value = 'SQL Preparation';
  schedulerElement('schedulerDays').value = '14';
  schedulerElement('schedulerDailyHours').value = '2';
  schedulerElement('schedulerRevision').value = 'weekly';
  schedulerElement('schedulerReminderTime').value = '19:00';
  schedulerElement('schedulerTopics').value = [
    'SQL SELECT and WHERE | Easy | High | 45 | https://youtube.com/ | Practice 15 basic queries',
    'ORDER BY, TOP, LIMIT, OFFSET | Medium | High | 60 | | Solve pagination questions',
    'GROUP BY and HAVING | Medium | High | 75 | | Practice aggregate questions',
    'JOINS | Hard | High | 120 | https://youtube.com/ | Practice inner, left, right joins',
    'Subqueries | Hard | Medium | 90 | | Solve 10 subquery questions',
    'UPDATE and DELETE | Medium | Medium | 60 | | Write safe update/delete queries',
    'Constraints and Primary Key | Medium | Low | 45 | | Revise common errors'
  ].join('\n');
  showToast('Sample syllabus loaded');
}

function clearSchedulerForm() {
  schedulerElement('schedulerForm').reset();
  schedulerElement('schedulerDailyHours').value = '2';
  schedulerElement('schedulerRevision').value = 'weekly';
  schedulerElement('schedulerReminderTime').value = '19:00';
  schedulerElement('schedulerBufferLevel').value = 'normal';
  document.querySelectorAll('input[name="preferredDay"]').forEach((input) => { input.checked = true; });
  clearSchedulerPreview();
}

function generateScheduleFromForm(event) {
  event.preventDefault();
  try {
    const config = getSchedulerFormData();
    const plan = makeSchedule(config);
    renderSchedulePreview(plan);
    showToast('Schedule generated');
  } catch (error) {
    showToast(error.message);
  }
}

function getMissedSchedulerItems() {
  return state.items
    .filter((item) => item.source === 'smart-scheduler' && item.status !== 'Done' && isOverdue(item))
    .sort(sortSmart);
}

function nextAvailableStudyDate(fromISO = todayISO()) {
  const checked = getSelectedPreferredDays();
  const preferred = checked.length ? checked : [0, 1, 2, 3, 4, 5, 6];
  let cursor = addDaysISO(fromISO, 1);
  for (let i = 0; i < 30; i += 1) {
    const day = new Date(`${cursor}T00:00:00`).getDay();
    if (preferred.includes(day)) return cursor;
    cursor = addDaysISO(cursor, 1);
  }
  return addDaysISO(fromISO, 1);
}

function rescheduleMissedItem(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  const oldDate = getItemDate(item);
  const newDate = nextAvailableStudyDate();
  item.missedReason = `Missed original date ${oldDate || 'not set'}`;
  item.rescheduledDate = newDate;
  item.dueDate = newDate;
  item.scheduledDate = newDate;
  if (item.reminderAt) item.reminderAt = `${newDate}T${item.reminderAt.slice(11, 16) || '19:00'}`;
  item.updatedAt = nowISO();
  item.syncStatus = window.StudyFlowCloudSync?.getUser?.() ? 'pending' : item.syncStatus;
  item.calendarSyncStatus = item.googleCalendarEventId ? 'needs_update' : item.calendarSyncStatus;
  saveState();
  renderAll();
  showToast('Missed item rescheduled');
}

function rescheduleAllMissed() {
  const missed = getMissedSchedulerItems();
  if (!missed.length) {
    showToast('No missed scheduler tasks found');
    return;
  }
  if (!confirm(`Move ${missed.length} missed scheduler task${missed.length === 1 ? '' : 's'} to next available study days?`)) return;

  let cursor = todayISO();
  missed.forEach((item) => {
    const oldDate = getItemDate(item);
    const newDate = nextAvailableStudyDate(cursor);
    item.missedReason = `Missed original date ${oldDate || 'not set'}`;
    item.rescheduledDate = newDate;
    item.dueDate = newDate;
    item.scheduledDate = newDate;
    if (item.reminderAt) item.reminderAt = `${newDate}T${item.reminderAt.slice(11, 16) || '19:00'}`;
    item.updatedAt = nowISO();
    item.syncStatus = window.StudyFlowCloudSync?.getUser?.() ? 'pending' : item.syncStatus;
    item.calendarSyncStatus = item.googleCalendarEventId ? 'needs_update' : item.calendarSyncStatus;
    cursor = newDate;
  });
  saveState();
  renderAll();
  showToast('Missed tasks moved forward');
}

function renderMissedSchedulerTasks() {
  const container = schedulerElement('missedScheduleList');
  if (!container) return;
  const missed = getMissedSchedulerItems();
  container.innerHTML = missed.length
    ? missed.map((item) => `
      <article class="item-card overdue-card">
        <div class="item-top">
          <div>
            <h4 class="item-title">${escapeHTML(item.title)}</h4>
            <div class="badge-row">
              <span class="badge">${escapeHTML(item.scheduleKind || 'Scheduled')}</span>
              <span class="badge priority-${item.priority.toLowerCase()}">${escapeHTML(item.priority)}</span>
              <span class="badge priority-high">Overdue</span>
            </div>
          </div>
          <button class="action-btn" data-scheduler-action="reschedule-one" data-id="${escapeHTML(item.id)}" type="button">Reschedule</button>
        </div>
        <p class="muted">Original date: ${escapeHTML(formatDate(getItemDate(item)))}</p>
      </article>
    `).join('')
    : emptyState('No missed scheduler tasks', 'Overdue generated study tasks will appear here for quick rescheduling.');
}

function renderScheduler() {
  const section = schedulerElement('scheduler');
  if (!section) return;
  if (!schedulerPreview) clearSchedulerPreview();
  renderMissedSchedulerTasks();
}

function bindSchedulerEvents() {
  if (schedulerEventsBound || !schedulerElement('schedulerForm')) return;
  schedulerEventsBound = true;

  schedulerElement('schedulerForm').addEventListener('submit', generateScheduleFromForm);
  schedulerElement('saveGeneratedPlan').addEventListener('click', saveGeneratedPlan);
  schedulerElement('clearGeneratedPlan').addEventListener('click', clearSchedulerPreview);
  schedulerElement('loadSampleSyllabus').addEventListener('click', loadSampleSyllabus);
  schedulerElement('clearSchedulerForm').addEventListener('click', clearSchedulerForm);
  schedulerElement('rescheduleAllMissed').addEventListener('click', rescheduleAllMissed);

  schedulerElement('missedScheduleList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-scheduler-action="reschedule-one"]');
    if (!button) return;
    rescheduleMissedItem(button.dataset.id);
  });
}
