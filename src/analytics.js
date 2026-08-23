// GlitchIt Analytics — tracks platform metrics, user engagement, and content performance
// Stores data in localStorage with periodic sync to Supabase when available.

(function () {
  'use strict';

  const STORE_PREFIX = 'glitchit.analytics.';
  const WORKER_INTERVAL = 5 * 60 * 1000; // Run workers every 5 minutes

  // ─── Storage Helpers ──────────────────────────────────────────────
  function read(key, fallback = {}) {
    try {
      const raw = localStorage.getItem(STORE_PREFIX + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function write(key, data) {
    try {
      localStorage.setItem(STORE_PREFIX + key, JSON.stringify(data));
    } catch (e) { /* ignore */ }
  }

  // ─── Event Tracking ───────────────────────────────────────────────
  function trackEvent(category, action, label = '', value = 0) {
    const events = read('events', []);
    events.push({
      category,
      action,
      label,
      value,
      timestamp: Date.now(),
      page: document.body?.dataset?.page || 'unknown',
      user: window.GLITCHIT_USER?.id || 'anonymous',
    });
    // Keep last 1000 events
    if (events.length > 1000) events.splice(0, events.length - 1000);
    write('events', events);
  }

  function trackPageView(page) {
    const views = read('pageviews', {});
    const today = new Date().toISOString().split('T')[0];
    if (!views[today]) views[today] = {};
    views[today][page] = (views[today][page] || 0) + 1;
    // Keep last 30 days
    const dates = Object.keys(views).sort().slice(-30);
    const trimmed = {};
    dates.forEach(d => { trimmed[d] = views[d]; });
    write('pageviews', trimmed);
    trackEvent('navigation', 'pageview', page);
  }

  function trackEngagement(type, targetId, duration = 0) {
    const engagements = read('engagements', []);
    engagements.push({
      type, // 'view', 'like', 'comment', 'share', 'follow', 'tip', 'purchase'
      targetId,
      duration,
      timestamp: Date.now(),
      user: window.GLITCHIT_USER?.id || 'anonymous',
    });
    if (engagements.length > 2000) engagements.splice(0, engagements.length - 2000);
    write('engagements', engagements);
  }

  function trackRevenue(amount, type, description = '') {
    const revenue = read('revenue', []);
    revenue.push({
      amount,
      type, // 'premium', 'tip', 'purchase', 'wallet_deposit'
      description,
      timestamp: Date.now(),
      user: window.GLITCHIT_USER?.id || 'anonymous',
    });
    write('revenue', revenue);
  }

  // ─── Metrics Computation ──────────────────────────────────────────
  function getDailyMetrics(days = 7) {
    const views = read('pageviews', {});
    const engagements = read('engagements', []);
    const revenue = read('revenue', []);
    const metrics = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
      const dayViews = views[date] || {};
      const totalViews = Object.values(dayViews).reduce((a, b) => a + b, 0);
      const dayEngagements = engagements.filter(e => {
        const d = new Date(e.timestamp).toISOString().split('T')[0];
        return d === date;
      });
      const dayRevenue = revenue.filter(r => {
        const d = new Date(r.timestamp).toISOString().split('T')[0];
        return d === date;
      });

      metrics.push({
        date,
        views: totalViews,
        uniquePages: Object.keys(dayViews).length,
        engagements: dayEngagements.length,
        engagementTypes: countTypes(dayEngagements, 'type'),
        revenue: dayRevenue.reduce((a, r) => a + r.amount, 0),
        revenueCount: dayRevenue.length,
        premiumSignups: dayRevenue.filter(r => r.type === 'premium').length,
      });
    }
    return metrics;
  }

  function countTypes(arr, key) {
    const counts = {};
    arr.forEach(item => {
      const val = item[key];
      counts[val] = (counts[val] || 0) + 1;
    });
    return counts;
  }

  function getOverallStats() {
    const views = read('pageviews', {});
    const engagements = read('engagements', []);
    const revenue = read('revenue', []);
    const events = read('events', []);

    let totalViews = 0;
    Object.values(views).forEach(day => {
      Object.values(day).forEach(count => { totalViews += count; });
    });

    const totalRevenue = revenue.reduce((a, r) => a + r.amount, 0);
    const premiumUsers = new Set(revenue.filter(r => r.type === 'premium').map(r => r.user)).size;
    const uniqueVisitors = new Set(events.filter(e => e.action === 'pageview').map(e => e.user)).size;

    return {
      totalViews,
      totalEngagements: engagements.length,
      totalRevenue,
      totalTransactions: revenue.length,
      premiumUsers,
      uniqueVisitors,
      avgEngagementRate: totalViews > 0 ? ((engagements.length / totalViews) * 100).toFixed(1) + '%' : '0%',
      topEngagementTypes: countTypes(engagements, 'type'),
      revenueByType: countTypes(revenue, 'type'),
    };
  }

  function getContentPerformance() {
    const engagements = read('engagements', []);
    const performance = {};

    engagements.forEach(e => {
      if (!performance[e.targetId]) {
        performance[e.targetId] = { views: 0, likes: 0, comments: 0, shares: 0, tips: 0 };
      }
      if (e.type === 'view') performance[e.targetId].views++;
      if (e.type === 'like') performance[e.targetId].likes++;
      if (e.type === 'comment') performance[e.targetId].comments++;
      if (e.type === 'share') performance[e.targetId].shares++;
      if (e.type === 'tip') performance[e.targetId].tips++;
    });

    return Object.entries(performance)
      .map(([id, stats]) => ({
        id,
        ...stats,
        engagementScore: stats.likes * 1 + stats.comments * 2 + stats.shares * 3 + stats.tips * 5,
      }))
      .sort((a, b) => b.engagementScore - a.engagementScore)
      .slice(0, 50);
  }

  function getUserGrowth() {
    const events = read('events', []);
    const users = {};
    events.filter(e => e.action === 'pageview').forEach(e => {
      const date = new Date(e.timestamp).toISOString().split('T')[0];
      if (!users[date]) users[date] = new Set();
      users[date].add(e.user);
    });

    const growth = [];
    const allUsers = new Set();
    Object.keys(users).sort().forEach(date => {
      users[date].forEach(u => allUsers.add(u));
      growth.push({ date, uniqueUsers: allUsers.size });
    });
    return growth;
  }

  // ─── Export ────────────────────────────────────────────────────────
  window.GlitchItAnalytics = {
    trackEvent,
    trackPageView,
    trackEngagement,
    trackRevenue,
    getDailyMetrics,
    getOverallStats,
    getContentPerformance,
    getUserGrowth,
    WORKER_INTERVAL,
  };
})();
