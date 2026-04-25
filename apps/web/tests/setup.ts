import '@testing-library/jest-dom';

// Provide dummy Firebase config for tests that transitively import firebase/config
process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??= 'AIzaSyTestKeyForUnitTests000000000000';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??= 'test.firebaseapp.com';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??= 'test-project';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??= 'test.firebasestorage.app';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ??= '000000000000';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID ??= '1:000000000000:web:0000000000000000';