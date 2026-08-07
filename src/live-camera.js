// Live camera preview: opt-in only, with clear permission and device fallbacks.
(function attachLiveCameraPreview() {
  const player = document.getElementById('live-player');
  const video = player?.querySelector('.live-video');
  const toggle = document.getElementById('live-camera-toggle');
  const status = document.getElementById('live-camera-status');
  if (!player || !video || !toggle || !status) return;

  const sampleSrc = video.currentSrc || video.getAttribute('src') || '';
  let stream = null;
  let enabled = false;

  const setStatus = (message, tone = '') => {
    status.textContent = message;
    status.dataset.tone = tone;
  };

  const restoreSample = () => {
    video.srcObject = null;
    if (sampleSrc) video.src = sampleSrc;
    video.loop = true;
    video.load();
  };

  const stop = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    enabled = false;
    restoreSample();
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
      video.loop = false;
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
})();
