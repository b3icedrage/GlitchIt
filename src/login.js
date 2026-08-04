// GlitchIt — login / signup (Firebase Auth, compat API).
(function () {
  const auth = window.glitchFirebase?.auth?.();
  const form = document.getElementById('auth-form');
  const tabs = [...document.querySelectorAll('.auth-tab')];
  const errorEl = document.getElementById('auth-error');
  const nameField = document.getElementById('name-field');
  const eyeBtn = document.getElementById('auth-eye');
  const passwordInput = form.querySelector('[name="password"]');
  const submitBtn = form.querySelector('button[type="submit"]');
  let mode = 'login';

  if (!auth || !form) return;

  // Already signed in on this device? Skip straight to the app.
  auth.onAuthStateChanged((user) => {
    if (user) location.replace('index.html');
  });

  const setMode = (m) => {
    mode = m;
    tabs.forEach((t) => {
      const active = t.dataset.mode === m;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    nameField.hidden = m !== 'signup';
    passwordInput.autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    submitBtn.textContent = m === 'signup' ? 'Create account' : 'Log in';
    showError('');
  };
  tabs.forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));

  // Show / hide password
  eyeBtn.addEventListener('click', () => {
    const show = passwordInput.type === 'password';
    passwordInput.type = show ? 'text' : 'password';
    eyeBtn.classList.toggle('active', show);
    eyeBtn.setAttribute('aria-pressed', String(show));
    eyeBtn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });

  const showError = (msg) => {
    errorEl.hidden = !msg;
    errorEl.textContent = msg;
  };

  function friendlyAuthError(err) {
    const map = {
      'auth/invalid-email': 'Enter a valid email address.',
      'auth/user-not-found': 'No account found with that email. Try signing up.',
      'auth/wrong-password': 'Incorrect password. Try again.',
      'auth/weak-password': 'Password must be at least 6 characters.',
      'auth/email-already-in-use': 'An account with that email already exists. Log in instead.',
      'auth/too-many-requests': 'Too many attempts. Wait a moment and try again.',
      'auth/network-request-failed': 'Network error — check your connection.',
    };
    return map[err.code] || err.message || 'Something went wrong. Try again.';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = form.querySelector('[name="email"]').value.trim();
    const password = form.querySelector('[name="password"]').value;
    const name = form.querySelector('[name="name"]').value.trim();
    if (!email || !password) {
      showError('Enter your email and password.');
      return;
    }
    showError('');
    submitBtn.disabled = true;
    try {
      if (mode === 'signup') {
        const credential = await auth.createUserWithEmailAndPassword(email, password);
        if (name) await credential.user.updateProfile({ displayName: name });
      } else {
        await auth.signInWithEmailAndPassword(email, password);
      }
      // onAuthStateChanged picks up the session and routes to the app.
    } catch (err) {
      showError(friendlyAuthError(err));
      submitBtn.disabled = false;
    }
  });
})();
