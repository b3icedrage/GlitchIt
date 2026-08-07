(() => {
  const UPLOADS_KEY = 'glitchit.uploads.v1';

  const readUploads = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(UPLOADS_KEY) || 'null');
      return saved && saved.feed && saved.stories && saved.videos ? saved : null;
    } catch (err) {
      return null;
    }
  };

  const writeUploads = (uploads) => {
    try { localStorage.setItem(UPLOADS_KEY, JSON.stringify(uploads)); } catch (err) { /* storage unavailable */ }
  };

  const readFile = (file) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });

  const wireMessagesNotes = () => {
    if (document.body.dataset.page !== 'messages') return true;
    const shelf = document.getElementById('messages-notes-shelf');
    if (!shelf || typeof window.attachNotes !== 'function') return false;
    window.attachNotes('messages-notes-shelf');
    const add = document.getElementById('messages-note-add');
    if (add && !add.dataset.notesReady) {
      add.dataset.notesReady = 'true';
      add.addEventListener('click', () => window.openNoteComposer?.());
    }
    return true;
  };

  const wireStoryEditor = () => {
    if (document.body.dataset.page !== 'create') return true;
    if (new URLSearchParams(window.location.search).get('editStory') !== 'latest') return true;
    const uploads = readUploads();
    const story = uploads?.stories?.[0];
    const form = document.getElementById('create-form');
    if (!story || !form) return true;
    if (form.dataset.storyEditorReady) return true;
    form.dataset.storyEditorReady = 'true';

    const stage = document.getElementById('create-stage');
    const editScreen = document.getElementById('edit-screen');
    const tools = document.querySelector('.create-tools');
    const tabs = document.querySelector('.create-tabs')?.parentElement;
    const previewImg = document.getElementById('create-preview-thumb');
    const previewVideo = document.getElementById('create-preview-video');
    const title = form.querySelector('[name="title"]');
    const caption = form.querySelector('[name="caption"]');
    const location = form.querySelector('[name="location"]');
    const label = document.getElementById('create-form-head-label');
    const upload = document.getElementById('media-upload-input');
    const status = document.getElementById('create-status');
    let replacementFile = null;

    if (stage) stage.hidden = true;
    if (editScreen) editScreen.hidden = true;
    if (tools) tools.hidden = true;
    if (tabs) tabs.hidden = true;
    form.hidden = false;
    if (label) label.textContent = 'Change story';
    if (title) title.value = story.title || '';
    if (caption) caption.value = story.caption || '';
    if (location) location.value = story.location || '';

    const showPreview = (src, video = false) => {
      if (previewImg) {
        previewImg.hidden = video;
        if (!video) previewImg.src = src;
      }
      if (previewVideo) {
        previewVideo.hidden = !video;
        if (video) {
          previewVideo.src = src;
          previewVideo.play().catch(() => {});
        } else {
          previewVideo.pause();
          previewVideo.removeAttribute('src');
          previewVideo.load();
        }
      }
    };
    showPreview(story.src || story.preview || '', Boolean(story.src));

    upload?.addEventListener('change', async () => {
      const file = upload.files?.[0];
      if (!file) return;
      replacementFile = file;
      const src = await readFile(file);
      if (src) showPreview(src, file.type.startsWith('video/'));
      upload.value = '';
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const file = replacementFile || upload?.files?.[0];
      const next = {
        ...story,
        title: title?.value.trim() || story.title || 'Your story',
        caption: caption?.value || '',
        location: location?.value || '',
      };
      if (file?.size) {
        const src = await readFile(file);
        if (src) {
          next.preview = src;
          if (file.type.startsWith('video/')) {
            next.type = 'video';
            next.src = src;
            next.poster = story.poster || story.preview || '';
          } else {
            next.type = 'stories';
            delete next.src;
            delete next.poster;
          }
        }
      }
      uploads.stories[0] = next;
      writeUploads(uploads);
      if (status) {
        status.className = 'create-status ok';
        status.textContent = 'Story updated ✓';
      }
      window.setTimeout(() => { window.location.href = 'index.html'; }, 450);
    }, true);

    return true;
  };

  const bootEnhancements = () => {
    const notesReady = wireMessagesNotes();
    const storyReady = wireStoryEditor();
    if (!notesReady || !storyReady) window.setTimeout(bootEnhancements, 80);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootEnhancements, { once: true });
  else bootEnhancements();
})();
