# StudyFlow Planner - Cloud Sync + Google Calendar Upgrade

StudyFlow is a free static personal task manager and study planner. This version keeps the existing LocalStorage app and adds optional Google sign-in, Firebase Firestore cloud sync, Google Calendar automatic event creation, and optional PWA files.

## What still works without login

- Dashboard
- Task Manager
- Study Planner
- Assignment Tracker
- Video Library
- Daily Tracker
- Excel upload
- Smart Study Scheduler
- Manual Google Calendar link
- LocalStorage save
- Backup/import
- Dark mode
- Mobile layout

## New upgrade features

- Google sign-in through Firebase Authentication
- Firestore sync across laptop and phone
- Safe upload/merge of existing LocalStorage data
- Google Calendar automatic event creation after separate Calendar permission
- Calendar sync status on each task
- Manual Google Calendar link remains as fallback
- PWA manifest and service worker for app-like install support

## Important concept

Firebase Google login and Google Calendar permission are separate.

- Firebase Auth signs the user into StudyFlow and identifies their cloud data.
- Google Calendar OAuth asks for permission to create events in the user's Calendar.

## Files

```text
study-task-planner-cloud-sync/
├── index.html
├── style.css
├── app.js
├── scheduler.js
├── firebaseConfig.js
├── firebaseService.js
├── authService.js
├── cloudSync.js
├── googleCalendar.js
├── manifest.json
├── service-worker.js
├── firestore.rules
├── study_planner_excel_template.xlsx
└── README.md
```

## Firebase setup

1. Go to Firebase Console.
2. Create a project.
3. Add a Web app.
4. Copy the Firebase config.
5. Open `firebaseConfig.js` and replace the placeholder values.
6. Go to Authentication > Sign-in method.
7. Enable Google provider.
8. Go to Authentication > Settings > Authorized domains.
9. Add your GitHub Pages or Netlify domain.
10. Go to Firestore Database.
11. Create a Firestore database.
12. Replace the default rules with the contents of `firestore.rules`.

## Google Calendar setup

1. Go to Google Cloud Console.
2. Select the same project or create a project.
3. Enable Google Calendar API.
4. Go to APIs & Services > OAuth consent screen.
5. Configure consent screen.
6. Go to APIs & Services > Credentials.
7. Create OAuth client ID.
8. Select Web application.
9. Add your GitHub Pages/Netlify URL as Authorized JavaScript origin.
10. Copy the OAuth client ID.
11. Open `firebaseConfig.js`.
12. Replace `PASTE_GOOGLE_OAUTH_WEB_CLIENT_ID.apps.googleusercontent.com`.

## Firestore rules

Use the included `firestore.rules`. They allow each signed-in user to read/write only their own data under `users/{uid}`.

Do not use test mode rules for real phone use.

## Hosting on GitHub Pages

1. Create a GitHub repository.
2. Upload all files from this folder.
3. Go to Settings > Pages.
4. Select branch `main` and root folder.
5. Save.
6. Open the Pages URL.
7. Add that URL to Firebase authorized domains.
8. Add that URL to Google Cloud authorized JavaScript origins.

## How sync works

Local mode:

```text
Task added -> LocalStorage -> visible only on this browser/device
```

Cloud mode:

```text
Sign in -> choose Upload local data -> Firestore -> same account can load data on another device
```

Calendar mode:

```text
Connect Google Calendar -> task event created/updated -> Google Calendar sends phone notification
```

## Known limitations

- The app remains frontend-only. There is no backend server.
- Calendar access tokens are kept only in memory and may require reconnecting after expiry.
- Calendar event delete sync is not added yet.
- Offline changes are saved locally; cloud sync resumes when the app is open and online.
- Firebase/Google configuration must be added by you before login and Calendar automation work.
- If OAuth app is not verified, Google may show a testing/unverified app warning for sensitive scopes.

## Best next upgrades

- Better offline sync queue
- Calendar event update/delete sync
- Recurring calendar events
- Google Tasks API integration
- PWA icons
- Weekly report charts
- Weak topic tracker
- AI syllabus cleanup prompt
