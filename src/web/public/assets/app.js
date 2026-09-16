// ============================================
// OpenCOOP - Main Application
// ============================================

const API = '/ui';
let currentPage = 'config';
let currentConfig = { mode: null, workspacePath: '' };
let userName = localStorage.getItem('opencoop-user-name') || '';

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initThemeToggle();
  initMenuToggle();
  checkStatus();
  loadConfig();

  // Check if user name is set
  if (!userName) {
    showNameModal();
  }

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
    // Sync userName from server
    if (data.userName) {
      userName = data.userName;
      localStorage.setItem('opencoop-user-name', data.userName);
      const nameInput = document.getElementById('user-name-input');
      if (nameInput) nameInput.value = data.userName;
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
      text.textContent = 'Tunnel starting... (SSH connecting, please wait)';
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
    // Format: https://abc-xyz.tinyfi.sh/ui/invite/token123
    // We need: https://abc-xyz.tinyfi.sh
    if (hostUrl.includes('/ui/invite/')) {
      const urlObj = new URL(hostUrl);
      const tunnelBaseUrl = urlObj.origin;

      // Save tunnel URL to config. The local MCP endpoint proxies to the host
      // server-side, so tools serve host files instantly — no restart needed.
      await fetch(`${API}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'remote',
          hostUrl: tunnelBaseUrl,
        }),
      });

      showToast('success', 'Connected', 'Tools now serve host files live. No restart needed.');
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

async function updateUserName() {
  const input = document.getElementById('user-name-input');
  const name = input.value.trim();

  if (!name) {
    showToast('warning', 'Empty', 'Please enter a name');
    return;
  }

  try {
    const res = await fetch(`${API}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName: name }),
    });
    const data = await res.json();

    if (data.success) {
      userName = name;
      localStorage.setItem('opencoop-user-name', name);
      // Register in user sessions map
      fetch(`${API}/api/user/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName: name }),
      }).catch(() => {});
      showToast('success', 'Name Updated', `Display name changed to "${name}"`);
    } else {
      showToast('error', 'Error', 'Failed to update name');
    }
  } catch {
    showToast('error', 'Error', 'Failed to update name');
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
      activityContainer.innerHTML = recent.map((item, i) => {
        const displayName = item.userName || item.userId;
        return `
          <div class="activity-item" style="animation-delay: ${i * 0.05}s">
            <div class="activity-icon ${item.action}">${item.action.charAt(0).toUpperCase()}</div>
            <div class="activity-info">
              <div class="activity-file">${item.filePath}</div>
              <div class="activity-meta">
                <span class="change-user-name">
                  <span class="user-dot" style="background: ${getAvatarColor(displayName)}"></span>
                  ${displayName}
                </span>
                — ${formatTime(item.timestamp)}
              </div>
            </div>
          </div>
        `;
      }).join('');
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

let changesPage = 0;
const CHANGES_PER_PAGE = 20;
let changesTotal = 0;

async function loadChanges(page) {
  if (page !== undefined) changesPage = page;
  const filePath = document.getElementById('filter-file').value;
  const userId = document.getElementById('filter-user').value;

  try {
    const params = new URLSearchParams();
    if (filePath) params.set('file_path', filePath);
    if (userId) params.set('user_id', userId);
    params.set('limit', String(CHANGES_PER_PAGE));
    params.set('offset', String(changesPage * CHANGES_PER_PAGE));

    const res = await fetch(`${API}/api/changes?${params}`);
    const data = await res.json();

    const container = document.getElementById('changes-list');
    const changes = data.changes || [];
    changesTotal = data.total || changes.length;

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
      let html = changes.map((item, i) => {
        const displayName = item.userName || item.userId;
        const hasMetadata = item.metadata && item.metadata.includes('diff');
        const canRollback = ['update', 'create', 'rollback'].includes(item.action);
        return `
          <div class="change-item ${hasMetadata ? 'clickable' : ''}" data-idx="${i}" style="animation-delay: ${i * 0.03}s">
            <span class="change-action ${item.action}">${item.action}</span>
            <span class="change-file">${escapeHtml(item.filePath)}</span>
            <span class="change-user-name">
              <span class="user-dot" style="background: ${getAvatarColor(displayName)}"></span>
              ${escapeHtml(displayName)}
            </span>
            <span class="change-time">${formatTime(item.timestamp)}</span>
            ${hasMetadata ? '<button class="diff-btn" data-diff-idx="' + i + '"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg> View Diff</button>' : ''}
            ${canRollback ? '<button class="rollback-btn" data-rb-idx="' + i + '" title="Restore this file to how it looked before this change"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg> Rollback</button>' : ''}
            <button class="snapshots-btn" data-snaps-idx="' + i + '" title="See all saved versions of this file"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> History</button>
          </div>
        `;
      }).join('');

      // Pagination
      const totalPages = Math.ceil(changesTotal / CHANGES_PER_PAGE);
      if (totalPages > 1) {
        html += '<div class="pagination">';
        html += `<button class="btn btn-sm btn-ghost" onclick="loadChanges(0)" ${changesPage === 0 ? 'disabled' : ''}>&laquo; First</button>`;
        html += `<button class="btn btn-sm btn-ghost" onclick="loadChanges(${changesPage - 1})" ${changesPage === 0 ? 'disabled' : ''}>&lsaquo; Prev</button>`;
        for (let p = Math.max(0, changesPage - 2); p <= Math.min(totalPages - 1, changesPage + 2); p++) {
          html += `<button class="btn btn-sm ${p === changesPage ? 'btn-primary' : 'btn-ghost'}" onclick="loadChanges(${p})">${p + 1}</button>`;
        }
        html += `<button class="btn btn-sm btn-ghost" onclick="loadChanges(${changesPage + 1})" ${changesPage >= totalPages - 1 ? 'disabled' : ''}>Next &rsaquo;</button>`;
        html += `<button class="btn btn-sm btn-ghost" onclick="loadChanges(${totalPages - 1})" ${changesPage >= totalPages - 1 ? 'disabled' : ''}>Last &raquo;</button>`;
        html += `<span class="pagination-info">${changesPage + 1} / ${totalPages} (${changesTotal} total)</span>`;
        html += '</div>';
      }

      container.innerHTML = html;

      // Store changes data for modals (delegation reads from here so it
      // always uses the current page even though we bind only once).
      container._changesData = changes;

      // Bind buttons via event delegation (bound once — re-binding on every
      // page load would stack duplicate handlers).
      if (!container._changesBound) {
        container._changesBound = true;
        container.addEventListener('click', (e) => {
          const data = container._changesData || [];
          const diffBtn = e.target.closest('.diff-btn');
          if (diffBtn) {
            e.stopPropagation();
            const idx = parseInt(diffBtn.dataset.diffIdx);
            const item = data[idx];
            if (item) {
              const displayName = item.userName || item.userId;
              showDiffModal(item.filePath, displayName, item.metadata);
            }
            return;
          }
          const rbBtn = e.target.closest('.rollback-btn');
          if (rbBtn) {
            e.stopPropagation();
            const idx = parseInt(rbBtn.dataset.rbIdx);
            const item = data[idx];
            if (item) rollbackChange(item.id, item.filePath);
            return;
          }
          const snapsBtn = e.target.closest('.snapshots-btn');
          if (snapsBtn) {
            e.stopPropagation();
            const idx = parseInt(snapsBtn.dataset.snapsIdx);
            const item = data[idx];
            if (item) showSnapshotsModal(item.filePath);
            return;
          }
          const changeItem = e.target.closest('.change-item.clickable');
          if (changeItem) {
            const idx = parseInt(changeItem.dataset.idx);
            const item = data[idx];
            if (item) {
              const displayName = item.userName || item.userId;
              showDiffModal(item.filePath, displayName, item.metadata);
            }
          }
        });
      }
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
      membersContainer.innerHTML = members.map((member, i) => {
        const name = member.email || member.userId || 'Unknown';
        const source = member.source || 'invite';
        const roleLabel = source === 'host' ? 'Host'
          : source === 'web' ? 'Connected'
          : source === 'history' ? 'Contributor'
          : member.role || 'member';
        const roleClass = source === 'host' ? 'host'
          : source === 'web' ? 'connected'
          : 'member';
        return `
          <div class="member-item" style="animation-delay: ${i * 0.05}s">
            <div class="user-avatar" style="background: ${getAvatarColor(name)}">${name.charAt(0).toUpperCase()}</div>
            <div class="user-info">
              <div class="user-name">${escapeHtml(name)}</div>
              <div class="user-status">${source === 'host' ? 'Workspace owner' : source === 'web' ? 'Via web UI' : source === 'history' ? `Past contributor${member.changeCount ? ` • ${member.changeCount} changes` : ''}` : 'Via invite link'}</div>
            </div>
            <span class="member-role ${roleClass}">${roleLabel}</span>
          </div>
        `;
      }).join('');
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
            <div class="user-name">${escapeHtml(user.userId)}</div>
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

// ============================================
// Name Modal
// ============================================

function showNameModal() {
  document.getElementById('name-modal').classList.remove('hidden');
  document.getElementById('name-input').focus();
}

function hideNameModal() {
  document.getElementById('name-modal').classList.add('hidden');
}

async function saveUserName() {
  const input = document.getElementById('name-input');
  const name = input.value.trim();

  if (!name) {
    input.style.borderColor = 'var(--accent-danger)';
    setTimeout(() => { input.style.borderColor = ''; }, 1500);
    return;
  }

  userName = name;
  localStorage.setItem('opencoop-user-name', name);

  // Save to server config AND register user session
  try {
    await fetch(`${API}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName: name }),
    });
  } catch {}

  // Also register in user sessions map for attribution
  try {
    await fetch(`${API}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName: name }),
    });
  } catch {}

  hideNameModal();
  showToast('success', 'Welcome', `Hello, ${name}!`);
}

// Handle Enter key in name input
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const nameModal = document.getElementById('name-modal');
    if (nameModal && !nameModal.classList.contains('hidden')) {
      saveUserName();
    }
    const diffModal = document.getElementById('diff-modal');
    if (diffModal && !diffModal.classList.contains('hidden')) {
      closeDiffModal();
    }
  }
  if (e.key === 'Escape') {
    const diffModal = document.getElementById('diff-modal');
    if (diffModal && !diffModal.classList.contains('hidden')) {
      closeDiffModal();
    }
    const snapsModal = document.getElementById('snapshots-modal');
    if (snapsModal && !snapsModal.classList.contains('hidden')) {
      closeSnapshotsModal();
    }
  }
});

// ============================================
// Diff Viewer
// ============================================

function showDiffModal(filePath, userName, metadata) {
  const modal = document.getElementById('diff-modal');
  const title = document.getElementById('diff-title');
  const subtitle = document.getElementById('diff-subtitle');
  const content = document.getElementById('diff-content');

  title.textContent = filePath;
  subtitle.textContent = userName ? `by ${userName}` : '';

  let diff = null;
  try {
    const meta = JSON.parse(metadata);
    diff = meta.diff;
  } catch {}

  if (!diff || diff.length === 0) {
    content.innerHTML = '<div class="diff-empty">No diff available for this change</div>';
  } else {
    content.innerHTML = diff.map((line, i) => {
      const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
      return `<div class="diff-line ${line.type}">
        <span class="diff-line-num">${i + 1}</span>
        <span class="diff-line-content">${prefix} ${escapeHtml(line.line)}</span>
      </div>`;
    }).join('');
  }

  modal.classList.remove('hidden');
}

function closeDiffModal() {
  document.getElementById('diff-modal').classList.add('hidden');
}

// ============================================
// Snapshots & Rollback
// ============================================

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(1)) + ' ' + units[i];
}

async function rollbackChange(changeId, filePath) {
  if (!confirm(`Restore "${filePath}" to how it looked BEFORE this change?\n\nThe current version is snapshotted first, so this is reversible.`)) return;
  try {
    const res = await fetch(`${API}/api/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ change_id: changeId }),
    });
    const data = await res.json();
    if (data.success) {
      showToast('success', 'Rolled back', `${filePath} restored to version from ${formatTime(data.restoredFrom)}`);
      loadChanges();
    } else {
      showToast('error', 'Rollback failed', data.error || 'Unknown error');
    }
  } catch {
    showToast('error', 'Rollback failed', 'Network error');
  }
}

async function showSnapshotsModal(filePath) {
  const modal = document.getElementById('snapshots-modal');
  document.getElementById('snapshots-title').textContent = filePath;
  document.getElementById('snapshots-subtitle').textContent = 'Saved versions (newest first)';
  const content = document.getElementById('snapshots-content');
  content.innerHTML = '<div class="diff-empty">Loading versions...</div>';
  modal.classList.remove('hidden');

  try {
    const res = await fetch(`${API}/api/snapshots?file=${encodeURIComponent(filePath)}&limit=20`);
    const data = await res.json();
    const snaps = data.snapshots || [];
    if (snaps.length === 0) {
      content.innerHTML = '<div class="diff-empty">No saved versions yet.<br>Snapshots are created automatically on every write/edit.</div>';
      return;
    }
    content.innerHTML = snaps.map((s, i) => `
      <div class="snapshot-item">
        <div class="snapshot-info">
          <div class="snapshot-version">Version ${snaps.length - i} ${i === 0 ? '<span class="snapshot-badge">latest backup</span>' : ''}</div>
          <div class="snapshot-meta">${formatTime(s.createdAt)}${s.createdBy ? ' • by ' + escapeHtml(s.createdBy) : ''} • ${formatBytes(s.size)}</div>
        </div>
        <button class="btn btn-sm btn-secondary" onclick="restoreSnapshot('${encodeURIComponent(filePath)}', '${s.id}')">Restore</button>
      </div>
    `).join('');
  } catch {
    content.innerHTML = '<div class="diff-empty">Failed to load versions</div>';
  }
}

async function restoreSnapshot(encodedPath, snapshotId) {
  const filePath = decodeURIComponent(encodedPath);
  if (!confirm(`Restore "${filePath}" to this saved version?\n\nThe current version is snapshotted first, so this is reversible.`)) return;
  try {
    const res = await fetch(`${API}/api/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, snapshot_id: snapshotId }),
    });
    const data = await res.json();
    if (data.success) {
      showToast('success', 'Restored', `${filePath} restored`);
      closeSnapshotsModal();
      loadChanges();
    } else {
      showToast('error', 'Restore failed', data.error || 'Unknown error');
    }
  } catch {
    showToast('error', 'Restore failed', 'Network error');
  }
}

function closeSnapshotsModal() {
  document.getElementById('snapshots-modal').classList.add('hidden');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
