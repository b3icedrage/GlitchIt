// GlitchIt Admin — authentication, dashboard rendering, and worker management
(function () {
  'use strict';

  // ─── Credentials ──────────────────────────────────────────────────
  const ADMIN_USER = 'Nm';
  const ADMIN_PASS = 'Brian69#$756';

  // ─── DOM Elements ─────────────────────────────────────────────────
  const loginGate = document.getElementById('login-gate');
  const dashboard = document.getElementById('dashboard');
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const loginError = document.getElementById('login-error');
  const adminUser = document.getElementById('admin-user');
  const adminPass = document.getElementById('admin-pass');

  // ─── Auth ─────────────────────────────────────────────────────────
  function checkAuth() {
    try {
      return sessionStorage.getItem('glitchit.admin.auth') === 'true';
    } catch (e) { return false; }
  }

  function login() {
    const user = adminUser.value.trim();
    const pass = adminPass.value;

    if (user === ADMIN_USER && pass === ADMIN_PASS) {
      sessionStorage.setItem('glitchit.admin.auth', 'true');
      showDashboard();
    } else {
      loginError.style.display = 'block';
      adminPass.value = '';
      adminPass.focus();
    }
  }

  function logout() {
    sessionStorage.removeItem('glitchit.admin.auth');
    loginGate.style.display = 'flex';
    dashboard.style.display = 'none';
    adminUser.value = '';
    adminPass.value = '';
  }

  function showDashboard() {
    loginGate.style.display = 'none';
    dashboard.style.display = 'block';
    renderStats();
    renderCharts();
    renderWorkers();
    renderLogs();
  }

  // ─── Stats ────────────────────────────────────────────────────────
  function renderStats() {
    const stats = window.GlitchItAnalytics?.getOverallStats() || {};
    const grid = document.getElementById('stats-grid');
    if (!grid) return;

    grid.innerHTML = `
      <div class="stat-card">
        <div class="label">Total Views</div>
        <div class="value">${(stats.totalViews || 0).toLocaleString()}</div>
        <div class="sub">All page views</div>
      </div>
      <div class="stat-card">
        <div class="label">Engagements</div>
        <div class="value">${(stats.totalEngagements || 0).toLocaleString()}</div>
        <div class="sub">Likes, comments, shares</div>
      </div>
      <div class="stat-card">
        <div class="label">Premium Users</div>
        <div class="value" style="color:#00c853;">${stats.premiumUsers || 0}</div>
        <div class="sub">Active subscribers</div>
      </div>
      <div class="stat-card">
        <div class="label">Revenue</div>
        <div class="value" style="color:#ffab00;">KES ${(stats.totalRevenue || 0).toLocaleString()}</div>
        <div class="sub">${stats.totalTransactions || 0} transactions</div>
      </div>
      <div class="stat-card">
        <div class="label">Unique Visitors</div>
        <div class="value">${stats.uniqueVisitors || 0}</div>
        <div class="sub">Distinct users</div>
      </div>
      <div class="stat-card">
        <div class="label">Engagement Rate</div>
        <div class="value" style="color:#008737;">${stats.avgEngagementRate || '0%'}</div>
        <div class="sub">Views → Engagements</div>
      </div>
    `;
  }

  // ─── Charts ───────────────────────────────────────────────────────
  function renderCharts() {
    const daily = window.GlitchItAnalytics?.getDailyMetrics(7) || [];
    renderBarChart('views-chart', daily, 'views');
    renderBarChart('engagements-chart', daily, 'engagements');
  }

  function renderBarChart(containerId, data, key) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const maxVal = Math.max(...data.map(d => d[key] || 0), 1);
    container.innerHTML = data.map(d => {
      const val = d[key] || 0;
      const height = Math.max((val / maxVal) * 100, 4);
      const day = new Date(d.date).toLocaleDateString('en', { weekday: 'short' });
      return `<div class="bar" style="height:${height}%">
        <span class="bar-value">${val}</span>
        <span class="bar-label">${day}</span>
      </div>`;
    }).join('');
  }

  // ─── Workers ──────────────────────────────────────────────────────
  function renderWorkers() {
    const container = document.getElementById('workers-container');
    if (!container) return;

    const allResults = window.GlitchItAIWorkers?.getAllResults() || {};
    container.innerHTML = Object.entries(allResults).map(([key, worker]) => {
      const lastRunAgo = worker.lastRun ? formatTimeAgo(worker.lastRun) : 'Never';
      const isActive = worker.lastRun && (Date.now() - worker.lastRun < 10 * 60 * 1000);

      const insightsHtml = worker.results.map(r => {
        const icons = { success: '✓', warning: '⚠', critical: '✕', info: 'ℹ', opportunity: '★' };
        return `<div class="insight severity-${r.severity}">
          <div class="insight-icon">${icons[r.severity] || '•'}</div>
          <div class="insight-text">
            <strong>${r.message}</strong>
            <small>${r.recommendation}</small>
          </div>
        </div>`;
      }).join('');

      return `<div class="worker-card">
        <div class="worker-header">
          <span class="worker-name">${worker.name}</span>
          <span class="worker-status ${isActive ? 'active' : 'idle'}">${isActive ? '● Active' : '○ Idle'}</span>
        </div>
        <div class="worker-desc">Last run: ${lastRunAgo}</div>
        <div class="worker-insights">${insightsHtml || '<div style="color:#626262;font-size:13px;">No insights yet — workers are analyzing...</div>'}</div>
      </div>`;
    }).join('');
  }

  // ─── Logs ─────────────────────────────────────────────────────────
  function renderLogs() {
    const container = document.getElementById('log-container');
    if (!container) return;

    const logs = window.GlitchItAIWorkers?.getLogs() || [];
    const recent = logs.slice(-50).reverse();

    container.innerHTML = recent.map(log => {
      const time = new Date(log.timestamp).toLocaleTimeString();
      return `<div class="log-entry">
        <span class="time">${time}</span>
        <span class="worker">${log.name}</span>
        ${log.message}
      </div>`;
    }).join('') || '<div style="color:#626262;font-size:13px;padding:20px;">No logs yet</div>';
  }

  // ─── Helpers ──────────────────────────────────────────────────────
  function formatTimeAgo(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  // ─── Event Listeners ──────────────────────────────────────────────
  loginBtn?.addEventListener('click', login);
  adminPass?.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  adminUser?.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  logoutBtn?.addEventListener('click', logout);

  document.getElementById('refresh-btn')?.addEventListener('click', () => {
    renderStats();
    renderCharts();
    renderWorkers();
    renderLogs();
  });

  document.getElementById('run-workers-btn')?.addEventListener('click', () => {
    window.GlitchItAIWorkers?.runAll();
    setTimeout(() => {
      renderWorkers();
      renderLogs();
    }, 500);
  });

  document.getElementById('clear-logs-btn')?.addEventListener('click', () => {
    localStorage.removeItem('glitchit.ai.workers.log');
    renderLogs();
  });

  // ─── Init ─────────────────────────────────────────────────────────
  if (checkAuth()) {
    showDashboard();
  }
})();
