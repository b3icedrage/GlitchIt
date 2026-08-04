// GlitchIt — Firebase initialization (compat SDK loaded from CDN).
// Exposes the app instance as window.glitchFirebase for the shared scripts.
const glitchFirebaseConfig = {
  apiKey: 'AIzaSyD8fN4BfaUWqmNpgXwigDvcqXB0XDU9K2U',
  authDomain: 'glitchit-ad136.firebaseapp.com',
  projectId: 'glitchit-ad136',
  storageBucket: 'glitchit-ad136.firebasestorage.app',
  messagingSenderId: '1013107296024',
  appId: '1:1013107296024:web:771344791db1aea334406d',
  measurementId: 'G-LL3Y3KBH8Q',
};

window.glitchFirebase = firebase.initializeApp(glitchFirebaseConfig);
try {
  if (firebase.analytics) window.glitchAnalytics = firebase.analytics();
} catch (e) { /* analytics unavailable — auth still works */ }
