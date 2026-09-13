// ==================== STATE ====================
let currentPage = 'config';
let currentMode = null;

// ==================== NAVIGATION ====================
document.querySelectorAll('.nav-links a').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const page = link.dataset.page;
    navigateTo(page);
  });
});

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));

  document.getElementById(`page-${page}`)?.classList.add('active');
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');

  currentPage = page;
  loadPageData(page);
}

async function loadPageData(page) {
  switch (page) {
    case 'dashboard': await loadDashboard(); break;
    case 'changes': await loadChanges(); break;
    case 'team': await loadTeam(); break;
    case 'locks': await loadLocks(); break;
    case 'config': await loadConfig(); break;
  }
}

// ==================== STATUS CHECK ====================
async function checkStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    document.getElementById('statusDot')?.classList.add('online');
    document.getElementById('statusText').textContent = `Running on port ${data.port}`;
  } catch (e) {
    document.getElementById('statusDot')?.classList.remove('online');
    document.getElementById('statusText').textContent = 'Offline';
  }
}

// ==================== CONFIG PAGE ====================
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();

    if (config.mode) {
      selectMode(config.mode);
    }
    if (config.workspacePath) {
      document.getElementById('workspace-path').value = config.workspacePath;
    }
    if (config.hostUrl) {
      document.getElementById('host-url').value = config.hostUrl;
    }
  } catch (e) {
    console.log('Failed to load config');
  }
}

function selectMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
  document.querySelector(`[data-mode="${mode}"]`)?.classList.add('selected');

  document.getElementById('host-config').classList.toggle('hidden', mode !== 'host');
  document.getElementById('remote-config').classList.toggle('hidden', mode !== 'remote');
}

function selectFolder() {
  const path = prompt('Enter project folder path:');
  if (path) {
    document.getElementById('workspace-path').value = path;
  }
}

async function generateInvite() {
  const workspacePath = document.getElementById('workspace-path').value;
  if (!workspacePath) {
    alert('Please enter a project folder path first');
    return;
  }

  try {
    const res = await fetch('/api/invite', {
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
      alert('Invite link generated!');
    }
  } catch (e) {
    alert('Error generating invite');
  }
}

function copyInviteLink() {
  const input = document.getElementById('invite-link');
  input.select();
  navigator.clipboard.writeText(input.value);
  alert('Copied!');
}

async function connectToHost() {
  const hostUrl = document.getElementById('host-url').value;
  if (!hostUrl) {
    alert('Please enter the host invite link');
    return;
  }

  try {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'remote', hostUrl })
    });
    alert('Connected! Restart OpenCode to apply.');
  } catch (e) {
    alert('Error connecting');
  }
}

async function saveConfig() {
  const workspacePath = document.getElementById('workspace-path').value;
  const hostUrl = document.getElementById('host-url').value;

  try {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: currentMode,
        workspacePath,
        hostUrl
      })
    });
    alert('Configuration saved!');
  } catch (e) {
    alert('Error saving config');
  }
}

// ==================== DASHBOARD PAGE ====================
async function loadDashboard() {
  try {
    const [statsRes, teamRes] = await Promise.all([
      fetch('/api/stats'),
      fetch('/api/team')
    ]);

    const stats = await statsRes.json();
    const team = await teamRes.json();

    document.getElementById('stat-total-changes').textContent = stats.totalChanges || 0;
    document.getElementById('stat-online-users').textContent = stats.onlineUsers || 0;
    document.getElementById('stat-active-locks').textContent = stats.activeLocks || 0;
    document.getElementById('stat-team-members').textContent = team.members?.length || 0;

    renderActivity(stats.recentActivity || []);
    renderOnlineUsers(stats.online || []);
    renderChangesByUser(stats.changesByUser || {});
    renderActiveLocks(stats.locks || []);
  } catch (e) {
    console.error('Failed to load dashboard', e);
  }
}

function renderActivity(changes) {
  const container = document.getElementById('recent-activity');
  if (!changes.length) {
    container.innerHTML = '<div class="empty-state"><p>No recent activity</p></div>';
    return;
  }

  container.innerHTML = changes.map(c => `
    <div class="activity-item">
      <span class="activity-file">${escapeHtml(c.filePath)}</span>
      <span class="activity-action ${c.action}">${c.action}</span>
      <span class="activity-user">${escapeHtml(c.userId)}</span>
      <span class="activity-time">${formatTime(c.timestamp)}</span>
    </div>
  `).join('');
}

function renderOnlineUsers(users) {
  const container = document.getElementById('online-users');
  if (!users.length) {
    container.innerHTML = '<div class="empty-state"><p>No users online</p></div>';
    return;
  }

  container.innerHTML = users.map(u => `
    <div class="user-item">
      <div class="user-avatar">${(u.user_id || 'U')[0].toUpperCase()}</div>
      <span class="user-name">${escapeHtml(u.user_id)}</span>
      <span class="user-status online">Online</span>
    </div>
  `).join('');
}

function renderChangesByUser(data) {
  const container = document.getElementById('changes-by-user');
  const entries = Object.entries(data);

  if (!entries.length) {
    container.innerHTML = '<div class="empty-state"><p>No data</p></div>';
    return;
  }

  const max = Math.max(...entries.map(([, v]) => v));

  container.innerHTML = entries.map(([user, count]) => `
    <div style="margin-bottom: 0.5rem;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
        <span>${escapeHtml(user)}</span>
        <span>${count}</span>
      </div>
      <div style="background: var(--bg-primary); border-radius: 4px; height: 8px;">
        <div style="background: var(--accent); height: 100%; width: ${(count / max) * 100}%; border-radius: 4px;"></div>
      </div>
    </div>
  `).join('');
}

function renderActiveLocks(locks) {
  const container = document.getElementById('active-locks');
  if (!locks.length) {
    container.innerHTML = '<div class="empty-state"><p>No active locks</p></div>';
    return;
  }

  container.innerHTML = locks.map(l => `
    <div class="activity-item">
      <span class="activity-file">${escapeHtml(l.filePath)}</span>
      <span class="activity-user">${escapeHtml(l.userId)}</span>
      <span class="activity-time">${l.reason || 'No reason'}</span>
    </div>
  `).join('');
}

// ==================== CHANGES PAGE ====================
async function loadChanges() {
  const filePath = document.getElementById('filter-file')?.value;
  const userId = document.getElementById('filter-user')?.value;

  try {
    const params = new URLSearchParams();
    if (filePath) params.set('file_path', filePath);
    if (userId) params.set('user_id', userId);
    params.set('limit', '100');

    const res = await fetch(`/api/changes?${params}`);
    const data = await res.json();

    renderChanges(data.changes || []);
  } catch (e) {
    console.error('Failed to load changes', e);
  }
}

function renderChanges(changes) {
  const container = document.getElementById('changes-list');
  if (!changes.length) {
    container.innerHTML = '<div class="empty-state"><p>No changes recorded yet</p></div>';
    return;
  }

  container.innerHTML = changes.map(c => `
    <div class="change-item">
      <span class="change-badge ${c.action}">${c.action}</span>
      <span class="change-path">${escapeHtml(c.filePath)}</span>
      <span class="change-user">${escapeHtml(c.userId)}</span>
      <span class="change-time">${formatTime(c.timestamp)}</span>
    </div>
  `).join('');
}

// ==================== TEAM PAGE ====================
async function loadTeam() {
  try {
    const res = await fetch('/api/team');
    const data = await res.json();

    renderTeamMembers(data.members || []);
    renderTeamOnline(data.online || []);
  } catch (e) {
    console.error('Failed to load team', e);
  }
}

function renderTeamMembers(members) {
  const container = document.getElementById('team-members');
  if (!members.length) {
    container.innerHTML = '<div class="empty-state"><p>No team members yet</p></div>';
    return;
  }

  container.innerHTML = members.map(m => `
    <div class="user-item">
      <div class="user-avatar">${(m.user_id || 'U')[0].toUpperCase()}</div>
      <span class="user-name">${escapeHtml(m.user_id)}</span>
      <span class="user-status">${m.permissions || 'read,write'}</span>
    </div>
  `).join('');
}

function renderTeamOnline(users) {
  const container = document.getElementById('team-online');
  if (!users.length) {
    container.innerHTML = '<div class="empty-state"><p>No users online</p></div>';
    return;
  }

  container.innerHTML = users.map(u => `
    <div class="user-item">
      <div class="user-avatar">${(u.user_id || 'U')[0].toUpperCase()}</div>
      <span class="user-name">${escapeHtml(u.user_id)}</span>
      <span class="user-status online">Online</span>
    </div>
  `).join('');
}

async function createInvite() {
  const email = document.getElementById('invite-email').value;
  const permissions = document.getElementById('invite-permissions').value.split(',');
  const days = parseInt(document.getElementById('invite-days').value) || 7;

  if (!email) {
    alert('Please enter an email');
    return;
  }

  try {
    const res = await fetch('/api/invite', {
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
    }
  } catch (e) {
    alert('Error creating invite');
  }
}

function copyGeneratedInvite() {
  const input = document.getElementById('generated-invite');
  input.select();
  navigator.clipboard.writeText(input.value);
  alert('Copied!');
}

// ==================== LOCKS PAGE ====================
async function loadLocks() {
  try {
    const res = await fetch('/api/locks');
    const data = await res.json();

    renderLocks(data.locks || []);
  } catch (e) {
    console.error('Failed to load locks', e);
  }
}

function renderLocks(locks) {
  const container = document.getElementById('locks-list');
  if (!locks.length) {
    container.innerHTML = '<div class="empty-state"><p>No active locks</p></div>';
    return;
  }

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>File</th>
          <th>Locked By</th>
          <th>Reason</th>
          <th>Acquired</th>
          <th>Expires</th>
        </tr>
      </thead>
      <tbody>
        ${locks.map(l => `
          <tr>
            <td>${escapeHtml(l.filePath)}</td>
            <td>${escapeHtml(l.userId)}</td>
            <td>${escapeHtml(l.reason || '-')}</td>
            <td>${formatTime(l.acquiredAt)}</td>
            <td>${formatTime(l.expiresAt)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// ==================== UTILITIES ====================
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;

  return d.toLocaleDateString();
}

// ==================== INIT ====================
checkStatus();
loadConfig();
setInterval(checkStatus, 30000);
