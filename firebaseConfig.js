// Firebase + Google API configuration
// Replace the placeholder values with your Firebase web app config and Google OAuth Client ID.
// This file is safe to keep in a static frontend because Firebase web config and OAuth client IDs are public identifiers.
// Security comes from Firebase Authentication, Firestore security rules, and Google OAuth consent.

export const firebaseConfig = {
  apiKey: "AIzaSyDQKOpvRni36ckRqO_i6cBZAw1PByjjax4",
  authDomain: "study-task-planner-fea75.firebaseapp.com",
  projectId: "study-task-planner-fea75",
  storageBucket: "study-task-planner-fea75.firebasestorage.app",
  messagingSenderId: "157108314711",
  appId: "1:157108314711:web:44ec60c383006d08353912"
};

export const googleCalendarConfig = {
  // Create this in Google Cloud Console > APIs & Services > Credentials > OAuth client ID > Web application.
  clientId: '157108314711-dif66asggf80i56mdope2fni17pav832.apps.googleusercontent.com',
  calendarScope: 'https://www.googleapis.com/auth/calendar.events'
};

export function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    !firebaseConfig.apiKey.includes('PASTE_') &&
    !firebaseConfig.projectId.includes('PASTE_')
  );
}

export function isGoogleCalendarConfigured() {
  return Boolean(
    googleCalendarConfig.clientId &&
    !googleCalendarConfig.clientId.includes('PASTE_')
  );
}
