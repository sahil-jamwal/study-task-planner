// Firebase + Google API configuration
// Replace the placeholder values with your Firebase web app config and Google OAuth Client ID.
// This file is safe to keep in a static frontend because Firebase web config and OAuth client IDs are public identifiers.
// Security comes from Firebase Authentication, Firestore security rules, and Google OAuth consent.

export const firebaseConfig = {
  apiKey: 'PASTE_FIREBASE_API_KEY',
  authDomain: 'PASTE_PROJECT_ID.firebaseapp.com',
  projectId: 'PASTE_PROJECT_ID',
  storageBucket: 'PASTE_PROJECT_ID.firebasestorage.app',
  messagingSenderId: 'PASTE_MESSAGING_SENDER_ID',
  appId: 'PASTE_FIREBASE_APP_ID'
};

export const googleCalendarConfig = {
  // Create this in Google Cloud Console > APIs & Services > Credentials > OAuth client ID > Web application.
  clientId: 'PASTE_GOOGLE_OAUTH_WEB_CLIENT_ID.apps.googleusercontent.com',
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
