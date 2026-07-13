<div align="center">

# StudyFlow

**A calm daily study planner. Open it, see what to study today, do it, watch each subject fill up.**

Plan your own study, track it by subject, and feel steady progress — without the clutter.

</div>

---

## What it does

- **Today** — your greeting, a progress ring, the one task to do next, a 7-day week strip, and today's list.
- **Tasks** — everything in one place, filtered by your own subjects (Python, Computational Thinking, Reading…), with search and an Import/Export toolbar.
- **Progress** — completion percentage per subject, plus a gentle cheer when you finish something ahead of time.
- **Focus timer** — tap *Start* on any task for a distraction-free countdown.
- **Reminders** — a browser notification at the time you set (while the app is open).
- **Import / Export** — bring your plan in from Excel; export your tasks back out any time.
- **Works offline**, installs like an app (PWA), and has a warm light + dark theme.

## Optional cloud features (need a free Firebase project)

- **Google sign-in** so your data is the same on phone and laptop.
- **Live cross-device sync** — add or delete on one device, it updates on the other (deletes included).
- **Google Calendar** — one tap to add tasks as calendar events; deleting a task removes its event too.

Without signing in, StudyFlow saves everything to your browser and works fully on its own.

---

## Use it

Just open the site. Add a task with **+ Add**, or bring your whole plan in via **Tasks -> Import from Excel**.

**Excel columns** (only *Task Title* is required):

| Task Title | Subject | Due Date | Reminder Date Time | Estimated Minutes | YouTube Link | Assignment |
|------------|---------|----------|--------------------|-------------------|--------------|------------|

Dates use `YYYY-MM-DD` (e.g. `2026-07-13`); reminders use `YYYY-MM-DD HH:MM`.

---

## Run it yourself (GitHub Pages)

1. Put all the files in a repository.
2. **Settings -> Pages ->** branch `main`, root folder, **Save**.
3. Open the Pages URL. That's your live app.

It runs as-is in local mode. Cloud sync and Calendar are optional and need the setup below.

## Optional: enable cloud sync + calendar

**Firebase**
1. Create a project at the Firebase Console and add a Web app.
2. Paste its config into `firebaseConfig.js`.
3. **Authentication -> Sign-in method ->** enable **Google**.
4. **Authentication -> Settings -> Authorized domains ->** add your Pages URL.
5. **Firestore Database ->** create it, then paste `firestore.rules` into the **Rules** tab and **Publish**.

**Google Calendar (optional)**
1. In Google Cloud Console, enable the **Google Calendar API**.
2. **Credentials ->** create an **OAuth client ID** (Web), add your Pages URL as an authorized JavaScript origin.
3. Paste the client ID into `firebaseConfig.js`.

> **Security note:** the Firebase API key and OAuth client ID in `firebaseConfig.js` are *public identifiers by design* — safe to ship. Your data is protected by the Firestore rules, so make sure they're actually **Published** in the console. Restrict the API key and OAuth origin to your own domain to protect your quota. If any secret was ever hardcoded here in the past, rotate it.

---

## Project files

```
index.html          - app shell and markup
style.css           - Ink & Amber theme
app.js              - all app logic (tasks, today, progress, focus, reminders, import/export)
firebaseConfig.js   - your Firebase + OAuth config (you fill this in)
firebaseService.js  - Firebase SDK setup
authService.js      - Google sign-in
cloudSync.js        - live Firestore sync (with soft-delete so deletes propagate)
googleCalendar.js   - add / delete calendar events
manifest.json       - PWA manifest
service-worker.js   - offline cache (network-first, so updates show on a normal refresh)
firestore.rules     - per-user security rules
```

## How syncing works

- **Local:** every change saves instantly to your browser and works offline.
- **Cloud (signed in):** changes sync live across your devices; deletes use a soft-delete marker so they never silently reappear.
- **Calendar (connected):** tasks with a date/time become calendar events; deleting a task removes its event.

## Good to know

- Reminders fire while StudyFlow is open in the browser — a web app can't reliably alert you when fully closed.
- Calendar access is granted per browser session and may need reconnecting after it expires.
- Cloud sync resumes automatically when you're back online.

---

<div align="center">
Built as a personal daily study companion — simple, calm, and yours.
</div>
