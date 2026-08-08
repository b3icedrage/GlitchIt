(() => {
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

  const bootEnhancements = () => {
    if (!wireMessagesNotes()) window.setTimeout(bootEnhancements, 80);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootEnhancements, { once: true });
  else bootEnhancements();
})();
