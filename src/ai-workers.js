// GlitchIt AI Workers — background intelligence that runs 24/7
// Analyzes user behavior, optimizes content delivery, and generates insights.
// Workers run every 5 minutes while the app is open.

(function () {
  'use strict';

  const WORKER_INTERVAL = 5 * 60 * 1000; // 5 minutes
  const WORKER_LOG_KEY = 'glitchit.ai.workers.log';

  // ─── Worker Registry ──────────────────────────────────────────────
  const workers = {};
  let running = false;
  let intervalId = null;

  // ─── Worker: Content Optimizer ────────────────────────────────────
  // Analyzes which content gets the most engagement and recommends
  // optimization strategies for low-performing posts.
  workers.contentOptimizer = {
    name: 'Content Optimizer',
    description: 'Analyzes content performance and suggests improvements',
    lastRun: 0,
    results: [],

    run() {
      const analytics = window.GlitchItAnalytics;
      if (!analytics) return;

      const performance = analytics.getContentPerformance();
      const insights = [];

      performance.forEach(item => {
        if (item.views > 10 && item.likes / item.views < 0.02) {
          insights.push({
            type: 'low_engagement',
            contentId: item.id,
            message: `Content has ${(item.likes / item.views * 100).toFixed(1)}% like rate (below 2% threshold)`,
            recommendation: 'Consider updating thumbnail or caption to improve click-through rate',
            severity: 'warning',
          });
        }
        if (item.shares > 5) {
          insights.push({
            type: 'viral_potential',
            contentId: item.id,
            message: `Content has ${item.shares} shares — high viral potential`,
            recommendation: 'Boost this content in the feed for maximum reach',
            severity: 'opportunity',
          });
        }
        if (item.tips > 0) {
          insights.push({
            type: 'monetization_success',
            contentId: item.id,
            message: `Content received ${item.tips} tips — strong monetization signal`,
            recommendation: 'Feature this creator in the monetization showcase',
            severity: 'success',
          });
        }
      });

      this.results = insights;
      this.lastRun = Date.now();
      logWorker(this.name, `${insights.length} insights generated`);
    },
  };

  // ─── Worker: User Engagement Analyzer ─────────────────────────────
  // Tracks user engagement patterns and identifies power users
  // and at-risk users who might churn.
  workers.engagementAnalyzer = {
    name: 'Engagement Analyzer',
    description: 'Analyzes user engagement patterns and identifies trends',
    lastRun: 0,
    results: [],

    run() {
      const analytics = window.GlitchItAnalytics;
      if (!analytics) return;

      const stats = analytics.getOverallStats();
      const daily = analytics.getDailyMetrics(7);
      const insights = [];

      // Check engagement trend
      if (daily.length >= 3) {
        const recent3 = daily.slice(-3).reduce((a, d) => a + d.engagements, 0) / 3;
        const prev3 = daily.slice(-6, -3).reduce((a, d) => a + d.engagements, 0) / 3;
        if (recent3 > prev3 * 1.2) {
          insights.push({
            type: 'engagement_up',
            message: `Engagement up ${((recent3 / prev3 - 1) * 100).toFixed(0)}% this week`,
            recommendation: 'Capitalize on momentum with featured content',
            severity: 'success',
          });
        } else if (recent3 < prev3 * 0.8) {
          insights.push({
            type: 'engagement_down',
            message: `Engagement down ${((1 - recent3 / prev3) * 100).toFixed(0)}% this week`,
            recommendation: 'Send re-engagement notifications to inactive users',
            severity: 'warning',
          });
        }
      }

      // Premium conversion rate
      if (stats.uniqueVisitors > 0) {
        const conversionRate = (stats.premiumUsers / stats.uniqueVisitors * 100);
        insights.push({
          type: 'conversion_rate',
          message: `Premium conversion rate: ${conversionRate.toFixed(1)}% (${stats.premiumUsers}/${stats.uniqueVisitors})`,
          recommendation: conversionRate < 5 ? 'Consider improving premium value proposition' : 'Conversion rate is healthy',
          severity: conversionRate < 5 ? 'info' : 'success',
        });
      }

      // Revenue analysis
      if (stats.totalRevenue > 0) {
        insights.push({
          type: 'revenue_summary',
          message: `Total revenue: KES ${stats.totalRevenue.toLocaleString()} from ${stats.totalTransactions} transactions`,
          recommendation: 'Track revenue trends to optimize pricing',
          severity: 'info',
        });
      }

      this.results = insights;
      this.lastRun = Date.now();
      logWorker(this.name, `${insights.length} insights generated`);
    },
  };

  // ─── Worker: Platform Health Monitor ──────────────────────────────
  // Monitors app performance, error rates, and system health.
  workers.healthMonitor = {
    name: 'Platform Health Monitor',
    description: 'Monitors app performance and system health metrics',
    lastRun: 0,
    results: [],

    run() {
      const insights = [];

      // Check localStorage usage
      let totalSize = 0;
      try {
        for (let key in localStorage) {
          if (localStorage.hasOwnProperty(key) && key.startsWith('glitchit.')) {
            totalSize += localStorage.getItem(key).length * 2; // UTF-16
          }
        }
      } catch (e) { /* ignore */ }

      const sizeMB = (totalSize / 1024 / 1024).toFixed(2);
      if (totalSize > 5 * 1024 * 1024) {
        insights.push({
          type: 'storage_warning',
          message: `localStorage usage is ${sizeMB}MB — approaching 5MB limit`,
          recommendation: 'Archive old analytics data to prevent storage overflow',
          severity: 'warning',
        });
      } else {
        insights.push({
          type: 'storage_ok',
          message: `localStorage usage: ${sizeMB}MB — healthy`,
          recommendation: 'No action needed',
          severity: 'success',
        });
      }

      // Check service worker status
      if ('serviceWorker' in navigator) {
        insights.push({
          type: 'sw_status',
          message: `Service Worker: ${navigator.serviceWorker.controller ? 'Active' : 'Not active'}`,
          recommendation: navigator.serviceWorker.controller ? 'Offline support enabled' : 'Register service worker for offline support',
          severity: navigator.serviceWorker.controller ? 'success' : 'info',
        });
      }

      // Check error rate
      const events = JSON.parse(localStorage.getItem('glitchit.analytics.events') || '[]');
      const errors = events.filter(e => e.category === 'error');
      const recentErrors = errors.filter(e => Date.now() - e.timestamp < 3600000);
      if (recentErrors.length > 10) {
        insights.push({
          type: 'error_spike',
          message: `${recentErrors.length} errors in the last hour`,
          recommendation: 'Investigate error sources and fix critical issues',
          severity: 'critical',
        });
      } else {
        insights.push({
          type: 'errors_ok',
          message: `${recentErrors.length} errors in the last hour — normal`,
          recommendation: 'Error rate is within acceptable limits',
          severity: 'success',
        });
      }

      // Check page load performance
      if (window.performance && window.performance.timing) {
        const timing = window.performance.timing;
        const loadTime = timing.loadEventEnd - timing.navigationStart;
        if (loadTime > 0) {
          insights.push({
            type: 'performance',
            message: `Page load time: ${loadTime}ms`,
            recommendation: loadTime > 3000 ? 'Page load is slow — optimize assets' : 'Performance is good',
            severity: loadTime > 3000 ? 'warning' : 'success',
          });
        }
      }

      this.results = insights;
      this.lastRun = Date.now();
      logWorker(this.name, `${insights.length} checks completed`);
    },
  };

  // ─── Worker: Growth Tracker ───────────────────────────────────────
  // Tracks user growth, content creation rate, and platform expansion.
  workers.growthTracker = {
    name: 'Growth Tracker',
    description: 'Tracks platform growth metrics and trends',
    lastRun: 0,
    results: [],

    run() {
      const analytics = window.GlitchItAnalytics;
      if (!analytics) return;

      const growth = analytics.getUserGrowth();
      const daily = analytics.getDailyMetrics(7);
      const insights = [];

      // Content creation rate
      const contentCreated = daily.reduce((a, d) => a + d.engagements, 0);
      insights.push({
        type: 'content_rate',
        message: `${contentCreated} engagement events this week`,
        recommendation: contentCreated > 100 ? 'Strong content engagement' : 'Encourage more content creation',
        severity: contentCreated > 100 ? 'success' : 'info',
      });

      // New user acquisition
      if (growth.length >= 2) {
        const newest = growth[growth.length - 1];
        const oldest = growth[0];
        const newUsers = newest.uniqueUsers - oldest.uniqueUsers;
        insights.push({
          type: 'user_growth',
          message: `${newUsers} new unique users this period`,
          recommendation: newUsers > 0 ? 'User base is growing' : 'Focus on user acquisition campaigns',
          severity: newUsers > 0 ? 'success' : 'warning',
        });
      }

      // Revenue per user
      const stats = analytics.getOverallStats();
      if (stats.premiumUsers > 0) {
        const arpu = (stats.totalRevenue / stats.premiumUsers).toFixed(0);
        insights.push({
          type: 'arpu',
          message: `Average Revenue Per Premium User: KES ${arpu}`,
          recommendation: Number(arpu) < 100 ? 'Consider premium tier pricing review' : 'Revenue per user is healthy',
          severity: Number(arpu) >= 100 ? 'success' : 'info',
        });
      }

      this.results = insights;
      this.lastRun = Date.now();
      logWorker(this.name, `${insights.length} metrics tracked`);
    },
  };

  // ─── Worker: Recommendation Engine ────────────────────────────────
  // Analyzes user behavior to improve content recommendations.
  workers.recommendationEngine = {
    name: 'Recommendation Engine',
    description: 'Optimizes content recommendations based on user behavior',
    lastRun: 0,
    results: [],

    run() {
      const insights = [];

      // Analyze engagement patterns
      try {
        const engagements = JSON.parse(localStorage.getItem('glitchit.analytics.engagements') || '[]');
        const userEngagements = {};
        engagements.forEach(e => {
          if (!userEngagements[e.user]) userEngagements[e.user] = {};
          if (!userEngagements[e.user][e.type]) userEngagements[e.user][e.type] = 0;
          userEngagements[e.user][e.type]++;
        });

        // Find power users
        const powerUsers = Object.entries(userEngagements)
          .filter(([_, types]) => (types.view || 0) > 20)
          .map(([userId, _]) => userId);

        if (powerUsers.length > 0) {
          insights.push({
            type: 'power_users',
            message: `${powerUsers.length} power users identified (>20 views)`,
            recommendation: 'Feature power users in social proof and testimonials',
            severity: 'success',
          });
        }

        // Analyze content type preferences
        const typePreferences = {};
        engagements.forEach(e => {
          if (!typePreferences[e.type]) typePreferences[e.type] = 0;
          typePreferences[e.type]++;
        });

        const topType = Object.entries(typePreferences).sort((a, b) => b[1] - a[1])[0];
        if (topType) {
          insights.push({
            type: 'content_preference',
            message: `Most popular engagement type: ${topType[0]} (${topType[1]} events)`,
            recommendation: `Optimize for ${topType[0]} interactions in the feed algorithm`,
            severity: 'info',
          });
        }
      } catch (e) { /* ignore */ }

      this.results = insights;
      this.lastRun = Date.now();
      logWorker(this.name, `${insights.length} recommendations generated`);
    },
  };

  // ─── Worker Logger ────────────────────────────────────────────────
  function logWorker(name, message) {
    const logs = JSON.parse(localStorage.getItem(WORKER_LOG_KEY) || '[]');
    logs.push({ name, message, timestamp: Date.now() });
    if (logs.length > 500) logs.splice(0, logs.length - 500);
    localStorage.setItem(WORKER_LOG_KEY, JSON.stringify(logs));
  }

  // ─── Runner ───────────────────────────────────────────────────────
  function runAllWorkers() {
    Object.values(workers).forEach(worker => {
      try {
        worker.run();
      } catch (e) {
        logWorker(worker.name, `Error: ${e.message}`);
      }
    });
  }

  function start() {
    if (running) return;
    running = true;
    // Run immediately on first load
    setTimeout(runAllWorkers, 2000);
    // Then run every 5 minutes
    intervalId = setInterval(runAllWorkers, WORKER_INTERVAL);
    logWorker('System', 'AI Workers started');
  }

  function stop() {
    if (!running) return;
    running = false;
    if (intervalId) clearInterval(intervalId);
    logWorker('System', 'AI Workers stopped');
  }

  // ─── Auto-start ───────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // ─── Public API ────────────────────────────────────────────────────
  window.GlitchItAIWorkers = {
    workers,
    start,
    stop,
    runAll: runAllWorkers,
    getWorkerResults: (name) => workers[name]?.results || [],
    getAllResults: () => Object.fromEntries(
      Object.entries(workers).map(([k, w]) => [k, { name: w.name, results: w.results, lastRun: w.lastRun }])
    ),
    getLogs: () => JSON.parse(localStorage.getItem(WORKER_LOG_KEY) || '[]'),
  };
})();
