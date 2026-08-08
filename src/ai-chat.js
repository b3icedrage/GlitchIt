/* GlitchIt AI assistant — floating chat widget.
 * Renders a ϟ launcher (Messages page) and a streaming chat panel that talks to
 * the server-side /api/chat proxy (NVIDIA NIM, OpenAI-compatible). Also opens
 * from the Settings → "GlitchIt AI assistant" row via window.GlitchItAI.open().
 * Plain script (defer), no module deps.
 */
(function () {
  'use strict';

  var TRANSCRIPT_KEY = 'glitchit.ai.transcript';
  var MAX_HISTORY = 24;
  var MAX_CHAR = 4000;

  var root = null;        // .ai-chat element
  var fab = null;         // .ai-fab element
  var messagesEl = null;
  var inputEl = null;
  var sendBtn = null;
  var chipsEl = null;
  var transcript = [];
  var streaming = false;
  var controller = null;
  var currentAssistant = null; // { bubble, contentEl, thinkingEl, thinkingState }
  var open = false;

  var SHOW_FAB = document.body.hasAttribute('data-ai-fab');

  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  function saveTranscript() {
    try {
      localStorage.setItem(TRANSCRIPT_KEY, JSON.stringify(transcript.slice(-MAX_HISTORY)));
    } catch (err) { /* private mode — ignore */ }
  }

  function loadTranscript() {
    try {
      var raw = localStorage.getItem(TRANSCRIPT_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (m) {
        return m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string';
      }).map(function (m) { return { role: m.role, content: m.content.slice(0, MAX_CHAR) }; });
    } catch (err) {
      return [];
    }
  }

  function currentUser() {
    try {
      var h = window.GLITCHIT_USER;
      return typeof h === 'string' ? h : '';
    } catch (err) { return ''; }
  }

  /* ---------------- DOM ---------------- */

  function buildRoot() {
    root = el('div', 'ai-chat');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'GlitchIt AI assistant');
    root.innerHTML =
      '<header class="ai-head">' +
      '<span class="ai-head-mark" aria-hidden="true">ϟ</span>' +
      '<div><strong>GlitchIt AI</strong><span class="ai-status"><i></i> Online · Support</span></div>' +
      '<button type="button" class="ai-close" aria-label="Close assistant">×</button>' +
      '</header>' +
      '<div class="ai-messages" role="log" aria-live="polite"></div>' +
      '<div class="ai-input-wrap">' +
      '<textarea rows="1" placeholder="Ask for help, or describe a problem…" aria-label="Message the AI assistant"></textarea>' +
      '<button type="button" class="ai-send" aria-label="Send message">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>' +
      '</button>' +
      '</div>';
    document.body.appendChild(root);

    messagesEl = root.querySelector('.ai-messages');
    inputEl = root.querySelector('textarea');
    sendBtn = root.querySelector('.ai-send');

    root.querySelector('.ai-close').addEventListener('click', close);
    sendBtn.addEventListener('click', function () { send(inputEl.value); });
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send(inputEl.value);
      }
    });
    inputEl.addEventListener('input', function () {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) close();
    });
  }

  function buildFab() {
    if (!SHOW_FAB) return;
    fab = el('button', 'ai-fab', '<span aria-hidden="true">ϟ</span>');
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Ask GlitchIt AI');
    fab.addEventListener('click', toggle);
    document.body.appendChild(fab);
  }

  /* ---------------- Messages ---------------- */

  function addBubble(role, className) {
    var bubble = el('div', 'ai-bubble ai-' + role + (className ? ' ' + className : ''));
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return bubble;
  }

  function addUserBubble(text) {
    var b = addBubble('user');
    b.textContent = text;
  }

  function showError(text) {
    var b = addBubble('assistant', 'ai-error');
    b.textContent = text;
  }

  function addAssistantBubble() {
    var bubble = el('div', 'ai-bubble ai-assistant');
    var thinking = el('details', 'ai-thinking');
    thinking.setAttribute('data-state', 'idle');
    thinking.innerHTML = '<summary>Thinking</summary><div></div>';
    thinking.addEventListener('toggle', function () {
      // Keep the open state consistent when the user collapses it manually.
      if (!thinking.open) thinking.setAttribute('data-state', 'idle');
    });
    bubble.appendChild(thinking);
    var content = el('div', 'ai-assistant-content');
    bubble.appendChild(content);
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return { bubble: bubble, contentEl: content, thinkingEl: thinking, thinkingOpen: false };
  }

  function scrollBottom() {
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderHistory() {
    messagesEl.textContent = '';
    if (!transcript.length) {
      renderGreeting();
      return;
    }
    transcript.forEach(function (m) {
      if (m.role === 'user') {
        var ub = addBubble('user');
        ub.textContent = m.content;
      } else {
        var ab = addAssistantBubble();
        if (m.reasoning) {
          ab.thinkingEl.setAttribute('data-state', 'done');
          ab.thinkingEl.open = false;
          ab.thinkingEl.querySelector('div').textContent = m.reasoning;
        }
        ab.contentEl.textContent = m.content;
      }
    });
  }

  function renderGreeting() {
    var b = addBubble('assistant');
    b.textContent = 'Hey — I\'m the GlitchIt AI assistant ⚡ I can help with complaints, bugs, orders, ' +
      'creating posts, and anything else around the app. What do you need?';
    chipsEl = el('div', 'ai-chips');
    var prompts = [
      'I have a complaint',
      'Something is broken',
      'How do I create a post?',
      'Escalate to a human',
    ];
    prompts.forEach(function (p) {
      var chip = el('button', 'ai-chip', p);
      chip.type = 'button';
      chip.addEventListener('click', function () { chipsEl.remove(); chipsEl = null; send(p); });
      chipsEl.appendChild(chip);
    });
    root.appendChild(chipsEl);
  }

  function clearChips() {
    if (chipsEl) { chipsEl.remove(); chipsEl = null; }
  }

  /* ---------------- Streaming ---------------- */

  // Accept both wire formats the server may emit: {t:'r'|'c'|'done'|'err', d}
  // and the descriptive {type:'reasoning'|'content'|'done'|'error', text}.
  function handleLine(line) {
    if (!line) return;
    var msg;
    try { msg = JSON.parse(line); } catch (err) { return; }
    if (!msg) return;
    var type = msg.t || msg.type;
    var data = msg.d || msg.text;
    if (typeof type !== 'string') return;

    if (type === 'r' || type === 'reasoning') {
      if (currentAssistant && !currentAssistant.thinkingOpen) {
        currentAssistant.thinkingOpen = true;
        currentAssistant.thinkingEl.open = true;
        currentAssistant.thinkingEl.setAttribute('data-state', 'working');
      }
      if (currentAssistant) {
        currentAssistant.thinkingEl.querySelector('div').textContent += data || '';
        scrollBottom();
      }
    } else if (type === 'c' || type === 'content') {
      if (currentAssistant) {
        currentAssistant.contentEl.textContent += data || '';
        currentAssistant.contentEl.classList.add('ai-caret');
        scrollBottom();
      }
    } else if (type === 'done') {
      if (currentAssistant) {
        currentAssistant.contentEl.classList.remove('ai-caret');
        currentAssistant.thinkingEl.setAttribute('data-state', 'done');
        currentAssistant.thinkingEl.open = false;
      }
    } else if (type === 'err' || type === 'error') {
      if (currentAssistant) {
        currentAssistant.contentEl.classList.remove('ai-caret');
        if (!currentAssistant.contentEl.textContent) {
          currentAssistant.bubble.classList.add('ai-error');
          currentAssistant.contentEl.textContent = data || 'Something went wrong.';
        } else {
          currentAssistant.contentEl.textContent += '\n\n⚠ ' + (data || 'Something went wrong.');
        }
      } else {
        showError(data || 'Something went wrong.');
      }
      scrollBottom();
    }
  }

  async function streamAssistant(res) {
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buf = '';
    try {
      for (;;) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        var nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          var line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          handleLine(line);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  function send(text) {
    text = (text || '').trim();
    if (!text || streaming) return;
    clearChips();

    addUserBubble(text);
    transcript.push({ role: 'user', content: text.slice(0, MAX_CHAR) });
    saveTranscript();

    streaming = true;
    sendBtn.disabled = true;
    inputEl.value = '';
    inputEl.style.height = 'auto';
    currentAssistant = addAssistantBubble();
    controller = new AbortController();

    var payload = {
      messages: transcript.slice(-MAX_HISTORY),
      user: currentUser(),
    };

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).then(function (res) {
      if (!res.ok) {
        // Never assume the error body is JSON — it can be a proxy 404 page or
        // plain text. Parse defensively so the user sees a useful message
        // instead of an "Unexpected token … is not valid JSON" crash.
        return res.text().then(function (text) {
          var detail = '';
          try {
            var parsed = JSON.parse(text);
            if (parsed && typeof parsed.error === 'string') detail = parsed.error;
          } catch (err) {
            // Looks like an HTML page (proxy/static fallback) — drop the body.
            if (!/^\s*</.test(text)) detail = text.slice(0, 140).trim();
          }
          throw new Error(detail || 'Request failed (' + res.status + ').');
        });
      }
      return streamAssistant(res);
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return;
      var content = currentAssistant ? currentAssistant.contentEl.textContent : '';
      if (!content) {
        currentAssistant.bubble.classList.add('ai-error');
        currentAssistant.contentEl.textContent = err && err.message
          ? err.message
          : 'Could not reach the AI assistant. Check your connection and try again.';
      }
    }).then(function () {
      streaming = false;
      sendBtn.disabled = false;
      var content = currentAssistant ? currentAssistant.contentEl.textContent : '';
      var reasoning = currentAssistant && currentAssistant.thinkingOpen
        ? currentAssistant.thinkingEl.querySelector('div').textContent.slice(0, MAX_CHAR)
        : '';
      if (currentAssistant) {
        currentAssistant.contentEl.classList.remove('ai-caret');
        if (currentAssistant.thinkingEl.getAttribute('data-state') === 'working') {
          currentAssistant.thinkingEl.setAttribute('data-state', 'done');
          currentAssistant.thinkingEl.open = false;
        }
      }
      if (content || reasoning) {
        transcript.push({ role: 'assistant', content: content.slice(0, MAX_CHAR), reasoning: reasoning });
        saveTranscript();
      } else if (transcript.length && transcript[transcript.length - 1].role === 'user') {
        // Nothing came back — drop the hanging question so history stays clean.
        transcript.pop();
        saveTranscript();
      }
      currentAssistant = null;
      controller = null;
    });
  }

  /* ---------------- Open / close ---------------- */

  function openPanel() {
    if (!root) buildRoot();
    if (!transcript.length) {
      transcript = loadTranscript();
      renderHistory();
    }
    open = true;
    root.classList.add('open');
    if (fab) fab.setAttribute('aria-expanded', 'true');
    setTimeout(function () { inputEl.focus(); }, 80);
  }

  function closePanel() {
    if (controller) { controller.abort(); controller = null; }
    if (!root) return;
    open = false;
    root.classList.remove('open');
    if (fab) fab.setAttribute('aria-expanded', 'false');
  }

  function toggle() {
    if (open) closePanel(); else openPanel();
  }

  /* ---------------- Wiring ---------------- */

  buildFab();

  // Settings → "GlitchIt AI assistant" row (profile page): open straight away.
  var settingsRows = document.querySelectorAll('[data-ai-support]');
  Array.prototype.forEach.call(settingsRows, function (row) {
    row.addEventListener('click', function () {
      document.body.classList.remove('settings-open'); // dismiss the drawer
      openPanel();
    });
  });

  window.GlitchItAI = {
    open: openPanel,
    close: closePanel,
    toggle: toggle,
  };
})();
