// Live camera preview: opt-in only, with clear permission and device fallbacks.
// There is no sample/demo video anymore — while the camera is off the player
// shows a standby state, and enabling the camera mirrors the front-facing
// selfie so the host sees themselves the same way the create camera does.
(function attachLiveCameraPreview() {
  const player = document.getElementById('live-player');
  const video = player?.querySelector('.live-video');
  const toggle = document.getElementById('live-camera-toggle');
  const status = document.getElementById('live-camera-status');
  const standby = document.getElementById('live-standby');
  if (!player || !video || !toggle || !status) return;

  let stream = null;
  let enabled = false;

  const setStatus = (message, tone = '') => {
    status.textContent = message;
    status.dataset.tone = tone;
  };

  const setStandby = (show) => {
    if (!standby) return;
    standby.hidden = !show;
    standby.setAttribute('aria-hidden', show ? 'false' : 'true');
  };

  const restoreOff = () => {
    video.srcObject = null;
    video.style.transform = '';
    setStandby(true);
  };

  const stop = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    enabled = false;
    restoreOff();
    toggle.disabled = false;
    toggle.setAttribute('aria-pressed', 'false');
    toggle.setAttribute('aria-label', 'Enable your camera');
    toggle.textContent = 'Enable camera';
    setStatus('Camera is off · tap Enable camera to preview yourself');
  };

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('Camera access is unavailable in this browser.', 'error');
      return;
    }
    toggle.disabled = true;
    setStatus('Requesting camera permission…');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 } },
        audio: false,
      });
      video.pause();
      video.removeAttribute('src');
      video.srcObject = stream;
      video.muted = true;
      // Mirror the front-facing selfie (like the create camera), so the host
      // sees themselves as they would in a mirror.
      video.style.transform = 'scaleX(-1)';
      setStandby(false);
      await video.play();
      enabled = true;
      toggle.disabled = false;
      toggle.setAttribute('aria-pressed', 'true');
      toggle.setAttribute('aria-label', 'Stop your camera');
      toggle.textContent = 'Stop camera';
      setStatus('Your camera preview is live · only you can see it here', 'ok');
    } catch (error) {
      stop();
      const message = error?.name === 'NotAllowedError'
        ? 'Camera permission was denied · allow access in your browser settings and try again.'
        : error?.name === 'NotFoundError'
          ? 'No camera was found on this device.'
          : 'Could not access your camera · check browser permissions and try again.';
      setStatus(message, 'error');
    }
  };

  toggle.addEventListener('click', () => {
    if (enabled) stop();
    else start();
  });
  window.addEventListener('pagehide', stop, { once: true });
  setStandby(true);
})();
