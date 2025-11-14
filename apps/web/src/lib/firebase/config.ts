/**
 * Firebase Client Configuration
 * Handles client-side Firebase initialization
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

// Firebase configuration
// Note: These credentials are PUBLIC and meant to be in client-side code.
// Security is enforced by Firebase Security Rules, not by hiding these values.
const firebaseConfig = {
  apiKey: "AIzaSyBkCJjpT2Kt3DlPlPQa745iwx1RCzAAHjU",
  authDomain: "retire-5250e.firebaseapp.com",
  projectId: "retire-5250e",
  storageBucket: "retire-5250e.firebasestorage.app",
  messagingSenderId: "106859282187",
  appId: "1:106859282187:web:9bd82c3f08f77725cfc376",
  measurementId: "G-QRVN9XBC4Z",
};

// Initialize Firebase (singleton pattern - only initialize once)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Firebase Auth
const auth = getAuth(app);

export { auth };
export default app;
