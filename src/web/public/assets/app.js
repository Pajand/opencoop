// ============================================
// OpenCOOP - Main Application
// ============================================

const API = '/ui';
let currentPage = 'config';
let currentConfig = { mode: null, workspacePath: '' };

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initThemeToggle();
  initMenuToggle();
  checkStatus();
  loadConfig();

  // Auto-refresh status
  setInterval(checkStatus, 10000);
});

// ============================================
// Navigation
// ============================================

function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      navigateTo(page);
    });
  });
}

function navigateTo(page) {
  currentPage = page;

  // Update nav items
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  // Update pages with animation
  document.querySelectorAll('.page').forEach(p => {
    if (p.id === `page-${page}`) {
      p.classList.add('active');
      p.style.animation = 'none';
      p.offsetHeight; // Trigger reflow
      p.style.animation = 'slideUp 0.4s ease forwards';
    } else {
      p.classList.remove('active');
    }
  });

  // Update page title
  const titles = {
    config: 'Configuration',
    dashboard: 'Dashboard',
    changes: 'Change History',
    team: 'Team Management',
    locks: 'File Locks'
  };
  document.getElementById('pageTitle').textContent = titles[page] || page;

  // Load page data
  loadPageData(page);

  // Close mobile menu
  document.getElementById('sidebar').classList.remove('open');
}

function loadPageData(page) {
  switch (page) {
    case 'dashboard':
      loadDashboard();
      break;
    case 'changes':
      loadChanges();
      break;
    case 'team':
      loadTeam();
      break;
    case 'locks':
      loadLocks();
      break;
  }
}

// ============================================
// Theme Toggle
// ============================================

function initThemeToggle() {
  const theme = localStorage.getItem('opencoop-theme') || 'dark';
  document.documentElement.dataset.theme = theme;

  document.getElementById('themeToggle').addEventListener('click', () => {
    const current = document.documentElement.dataset.theme;
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('opencoop-theme', next);
  });
}

// ============================================
// Mobile Menu
// ============================================

function initMenuToggle() {
  document.getElementById('menuToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });
}

// ============================================
// Toast Notifications
// ============================================

function showToast(type, title, message, duration = 4000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = {
    success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  toast.innerHTML = `
    <div class="toast-icon">${icons[type]}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      ${message ? `<div class="toast-message">${message}</div>` : ''}
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ============================================
// Status Check
// ============================================

async function checkStatus() {
  const el = document.getElementById('connectionStatus');
  try {
    const res = await fetch(`${API}/api/status`);
    if (res.ok) {
      el.className = 'connection-status connected';
      el.querySelector('.status-text').textContent = 'Connected';
    } else {
      el.className = 'connection-status error';
      el.querySelector('.status-text').textContent = 'Error';
    }
  } catch {
    el.className = 'connection-status error';
    el.querySelector('.status-text').textContent = 'Offline';
  }
}

// ============================================
// Config Page
// ============================================

async function loadConfig() {
  try {
    const res = await fetch(`${API}/api/config`);
    const data = await res.json();
    currentConfig = data;

    if (data.workspacePath) {
      document.getElementById('workspace-path').value = data.workspacePath;
    }
    if (data.mode) {
      selectMode(data.mode);
    }
    if (data.hostUrl) {
      document.getElementById('host-url').value = data.hostUrl;
    }
  } catch {
    // Use defaults
  }
}

function selectMode(mode) {
  currentConfig.mode = mode;

  document.querySelectorAll('.mode-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.mode === mode);
  });

  document.getElementById('host-config').classList.toggle('hidden', mode !== 'host');
  document.getElementById('remote-config').classList.toggle('hidden', mode !== 'remote');

  if (mode === 'host') loadTunnelStatus();

  document.getElementById('saveBar').classList.remove('hidden');
}

// Poll /tunnel-url (same origin, server root) and render the HOST tunnel badge:
// green = active (invite links use it), amber = starting, red = failed, gray = idle.
async function loadTunnelStatus() {
  const badge = document.getElementById('tunnel-status');
  const text = document.getElementById('tunnel-text');
  if (!badge || !text) return;
  try {
    const res = await fetch('/tunnel-url');
    if (!res.ok) throw new Error('no endpoint');
    const data = await res.json();
    if (data.url) {
      badge.className = 'tunnel-status active';
      text.textContent = `Tunnel active: ${data.url}`;
    } else if (data.starting) {
      badge.className = 'tunnel-status starting';
      text.textContent = 'Tunnel starting... (first run downloads ~30 MB, please wait)';
    } else if (data.error) {
      badge.className = 'tunnel-status failed';
      text.textContent = `Tunnel failed: ${data.error} — invite links use local IP`;
    } else {
      badge.className = 'tunnel-status idle';
      text.textContent = 'Tunnel off — save HOST mode to start it';
    }
  } catch {
    badge.className = 'tunnel-status idle';
    text.textContent = 'Tunnel status unavailable';
  }
}

setInterval(() => {
  const panel = document.getElementById('host-config');
  if (panel && !panel.classList.contains('hidden')) loadTunnelStatus();
}, 5000);

async function generateInvite() {

  try {
    const res = await fetch(`${API}/api/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'team@opencoop.local',
        permissions: ['read', 'write'],
        expires_in_days: 7
      })
    });
    const data = await res.json();

    if (data.success) {
      document.getElementById('invite-link').value = data.invite.link;
      showToast('success', 'Invite Generated', 'Link is ready to share');
    } else {
      showToast('error', 'Error', 'Failed to generate invite link');
    }
  } catch {
    showToast('error', 'Error', 'Failed to generate invite link');
  }
}

async function connectToHost() {
  const hostUrl = document.getElementById('host-url').value;
  if (!hostUrl) {
    showToast('warning', 'Missing URL', 'Please enter the host invite link');
    return;
  }

  try {
    // Extract tunnel URL from invite link
    // Format: https://abc-xyz.trycloudflare.com/ui/invite/token123
    // We need: https://abc-xyz.trycloudflare.com
    let mcpUrl = '';
    if (hostUrl.includes('/ui/invite/')) {
      const urlObj = new URL(hostUrl);
      const tunnelBaseUrl = urlObj.origin;
      mcpUrl = `${tunnelBaseUrl}/sse`;

      // Save tunnel URL to config
      await fetch(`${API}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'remote',
          hostUrl: tunnelBaseUrl,
        }),
      });

      showToast('success', 'Connected', `MCP URL: ${mcpUrl}\nRestart OpenCode to activate.`);
      return;
    }

    // Fallback: validate as invite token
    const token = hostUrl.split('/invite/')[1];
    if (token) {
      const res = await fetch(`${API}/api/invite/validate/${token}`);
      const result = await res.json();

      if (result.valid) {
        showToast('success', 'Connected', 'Successfully connected to host');
      } else {
        showToast('error', 'Invalid Link', result.reason || 'This invite link is not valid');
      }
    }
  } catch {
    showToast('error', 'Connection Failed', 'Could not connect to host');
  }
}

async function saveConfig() {
  const config = {
    mode: currentConfig.mode,
    workspacePath: document.getElementById('workspace-path').value
  };

  if (config.mode === 'remote') {
    config.hostUrl = document.getElementById('host-url').value;
  }

  if (!config.workspacePath && config.mode === 'host') {
    showToast('warning', 'Missing Path', 'Please enter the project folder path');
    return;
  }

  try {
    const res = await fetch(`${API}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    const data = await res.json();

    if (data.success) {
      showToast('success', 'Saved', 'Configuration saved successfully');
      document.getElementById('saveBar').classList.add('hidden');
      if (config.mode === 'host') {
        // Tunnel may have just started on-demand — refresh the badge.
        setTimeout(loadTunnelStatus, 2000);
      }
    } else {
      showToast('error', 'Error', 'Failed to save configuration');
    }
  } catch {
    showToast('error', 'Error', 'Failed to save configuration');
  }
}

function copyInviteLink() {
  const input = document.getElementById('invite-link');
  if (!input.value) {
    showToast('warning', 'Empty', 'Generate a link first');
    return;
  }
  copyTextToClipboard(input.value);
}

// Clipboard API only works in secure contexts (HTTPS/localhost).
// Fallback to execCommand so Copy also works over plain HTTP (e.g. http://server-ip:31313/ui).
function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(
      () => showToast('success', 'Copied', 'Invite link copied to clipboard'),
      () => fallbackCopy(text)
    );
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand('copy');
    showToast('success', 'Copied', 'Invite link copied to clipboard');
  } catch {
    showToast('error', 'Copy failed', 'Please copy the link manually');
  }
  document.body.removeChild(ta);
}

// ============================================
// Dashboard Page
// ============================================

async function loadDashboard() {
  try {
    const res = await fetch(`${API}/api/stats`);
    const data = await res.json();

    // Animate stat values
    animateValue('stat-total-changes', data.totalChanges || 0);
    animateValue('stat-online-users', data.onlineUsers || 0);
    animateValue('stat-active-locks', data.activeLocks || 0);

    // Load team count
    const teamRes = await fetch(`${API}/api/team`);
    const teamData = await teamRes.json();
    animateValue('stat-team-members', (teamData.members || []).length);

    // Recent activity
    const activityContainer = document.getElementById('recent-activity');
    const recent = data.recentActivity || [];

    if (recent.length === 0) {
      activityContainer.innerHTML = '<div class="empty-state"><p>No activity yet</p></div>';
    } else {
      activityContainer.innerHTML = recent.map((item, i) => `
        <div class="activity-item" style="animation-delay: ${i * 0.05}s">
          <div class="activity-icon ${item.action}">${item.action.charAt(0).toUpperCase()}</div>
          <div class="activity-info">
            <div class="activity-file">${item.filePath}</div>
            <div class="activity-meta">${item.userId} - ${formatTime(item.timestamp)}</div>
          </div>
        </div>
      `).join('');
    }

    // Online users
    const onlineContainer = document.getElementById('online-users');
    const online = data.online || [];

    if (online.length === 0) {
      onlineContainer.innerHTML = '<div class="empty-state"><p>No users online</p></div>';
    } else {
      onlineContainer.innerHTML = online.map((user, i) => `
        <div class="user-item" style="animation-delay: ${i * 0.05}s">
          <div class="user-avatar" style="background: ${getAvatarColor(user.userId)}">${user.userId.charAt(0).toUpperCase()}</div>
          <div class="user-info">
            <div class="user-name">${user.userId}</div>
            <div class="user-status online">Online</div>
          </div>
        </div>
      `).join('');
    }

    // Active locks
    const locksContainer = document.getElementById('active-locks');
    const locks = data.locks || [];

    if (locks.length === 0) {
      locksContainer.innerHTML = '<div class="empty-state"><p>No active locks</p></div>';
    } else {
      locksContainer.innerHTML = locks.map((lock, i) => `
        <div class="lock-item" style="animation-delay: ${i * 0.05}s">
          <div class="lock-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <div class="lock-info">
            <div class="lock-file">${lock.filePath}</div>
            <div class="lock-meta">${lock.userId} - expires ${formatTime(lock.expiresAt)}</div>
          </div>
        </div>
      `).join('');
    }
  } catch {
    showToast('error', 'Error', 'Failed to load dashboard data');
  }
}

function animateValue(elementId, end) {
  const el = document.getElementById(elementId);
  const start = parseInt(el.textContent) || 0;
  const duration = 600;
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (end - start) * eased);

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

// ============================================
// Changes Page
// ============================================

async function loadChanges() {
  const filePath = document.getElementById('filter-file').value;
  const userId = document.getElementById('filter-user').value;

  try {
    const params = new URLSearchParams();
    if (filePath) params.set('file_path', filePath);
    if (userId) params.set('user_id', userId);
    params.set('limit', '50');

    const res = await fetch(`${API}/api/changes?${params}`);
    const data = await res.json();

    const container = document.getElementById('changes-list');
    const changes = data.changes || [];

    if (changes.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.3">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
          <p>No changes recorded yet</p>
        </div>
      `;
    } else {
      container.innerHTML = changes.map((item, i) => `
        <div class="change-item" style="animation-delay: ${i * 0.03}s">
          <span class="change-action ${item.action}">${item.action}</span>
          <span class="change-file">${item.filePath}</span>
          <span class="change-user">${item.userId}</span>
          <span class="change-time">${formatTime(item.timestamp)}</span>
        </div>
      `).join('');
    }
  } catch {
    showToast('error', 'Error', 'Failed to load changes');
  }
}

// ============================================
// Team Page
// ============================================

async function loadTeam() {
  try {
    const res = await fetch(`${API}/api/team`);
    const data = await res.json();

    // Members
    const membersContainer = document.getElementById('team-members');
    const members = data.members || [];

    if (members.length === 0) {
      membersContainer.innerHTML = '<div class="empty-state"><p>No team members yet</p></div>';
    } else {
      membersContainer.innerHTML = members.map((member, i) => `
        <div class="member-item" style="animation-delay: ${i * 0.05}s">
          <div class="user-avatar" style="background: ${getAvatarColor(member.userId || 'U')}">${(member.userId || 'U').charAt(0).toUpperCase()}</div>
          <div class="user-info">
            <div class="user-name">${member.email || member.userId || 'Unknown'}</div>
            <div class="user-status">${member.role || 'member'}</div>
          </div>
          <span class="member-role">${(member.permissions || 'read').split(',').join(' + ')}</span>
        </div>
      `).join('');
    }

    // Online
    const onlineContainer = document.getElementById('team-online');
    const online = data.online || [];

    if (online.length === 0) {
      onlineContainer.innerHTML = '<div class="empty-state"><p>No users online</p></div>';
    } else {
      onlineContainer.innerHTML = online.map((user, i) => `
        <div class="user-item" style="animation-delay: ${i * 0.05}s">
          <div class="user-avatar" style="background: ${getAvatarColor(user.userId)}">${user.userId.charAt(0).toUpperCase()}</div>
          <div class="user-info">
            <div class="user-name">${user.userId}</div>
            <div class="user-status online">Online</div>
          </div>
        </div>
      `).join('');
    }
  } catch {
    showToast('error', 'Error', 'Failed to load team data');
  }
}

async function createInvite() {
  const email = document.getElementById('invite-email').value;
  const permissions = document.getElementById('invite-permissions').value.split(',');
  const days = parseInt(document.getElementById('invite-days').value) || 7;

  if (!email) {
    showToast('warning', 'Missing Email', 'Please enter an email address');
    return;
  }

  try {
    const res = await fetch(`${API}/api/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        permissions,
        expires_in_days: days
      })
    });
    const data = await res.json();

    if (data.success) {
      document.getElementById('generated-invite').value = data.invite.link;
      document.getElementById('invite-result').classList.remove('hidden');
      showToast('success', 'Invite Created', 'Share the link with your team member');
    } else {
      showToast('error', 'Error', 'Failed to create invite');
    }
  } catch {
    showToast('error', 'Error', 'Failed to create invite');
  }
}

function copyGeneratedInvite() {
  const input = document.getElementById('generated-invite');
  if (!input.value) {
    showToast('warning', 'Empty', 'Generate a link first');
    return;
  }
  copyTextToClipboard(input.value);
}

// ============================================
// Locks Page
// ============================================

async function loadLocks() {
  try {
    const res = await fetch(`${API}/api/locks`);
    const data = await res.json();

    const container = document.getElementById('locks-list');
    const locks = data.locks || [];

    if (locks.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.3">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <p>No active locks</p>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="locks-table-header">
          <span>File</span>
          <span>Locked By</span>
          <span>Reason</span>
          <span>Expires</span>
        </div>
        ${locks.map((lock, i) => `
          <div class="locks-table-row" style="animation-delay: ${i * 0.05}s">
            <span class="lock-file">${lock.filePath}</span>
            <span>${lock.userId}</span>
            <span>${lock.reason || '-'}</span>
            <span>${formatTime(lock.expiresAt)}</span>
          </div>
        `).join('')}
      `;
    }
  } catch {
    showToast('error', 'Error', 'Failed to load locks');
  }
}

// ============================================
// Helpers
// ============================================

function formatTime(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString();
}

function getAvatarColor(str) {
  const colors = [
    'linear-gradient(135deg, #8b5cf6, #06b6d4)',
    'linear-gradient(135deg, #10b981, #06b6d4)',
    'linear-gradient(135deg, #f59e0b, #ef4444)',
    'linear-gradient(135deg, #ec4899, #8b5cf6)',
    'linear-gradient(135deg, #06b6d4, #3b82f6)',
    'linear-gradient(135deg, #8b5cf6, #ec4899)',
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}
