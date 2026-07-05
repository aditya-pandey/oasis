// State Initialization
let state = {
  theme: 'dark',
  columns: ['Wishlist', 'Applied', 'Interview', 'Offer', 'Rejected'],
  applications: [],
  activities: [],
  resumes: []
};

// Initial Demo Data
const DEMO_DATA = {
  theme: 'dark',
  columns: ['Wishlist', 'Applied', 'Interview', 'Offer', 'Rejected'],
  applications: [],
  activities: [],
  resumes: []
};

// Supabase Global Client Reference
let supabaseClient = null;

// Supabase Sync Helpers
function initSupabase() {
  const url = localStorage.getItem('oasis_supa_url');
  const key = localStorage.getItem('oasis_supa_key');
  const btn = document.getElementById('btn-cloud-settings');
  
  if (url && key && window.supabase) {
    try {
      supabaseClient = window.supabase.createClient(url, key);
      updateSyncStatus('connected', 'Cloud Synced');
      return true;
    } catch (err) {
      console.error('Supabase init failed', err);
      updateSyncStatus('error', 'Error');
    }
  } else {
    updateSyncStatus('disconnected', 'Cloud Sync');
  }
  return false;
}

function updateSyncStatus(status, text) {
  const dot = document.getElementById('status-dot');
  const textEl = document.getElementById('status-text');
  const sidebarBtn = document.getElementById('btn-cloud-settings');
  
  if (dot) {
    dot.className = 'activity-status-dot';
    if (status === 'connected') {
      dot.style.backgroundColor = 'var(--success)';
    } else if (status === 'syncing') {
      dot.style.backgroundColor = 'var(--warning)';
    } else if (status === 'error') {
      dot.style.backgroundColor = 'var(--danger)';
    } else {
      dot.style.backgroundColor = 'var(--text-muted)';
    }
  }

  if (textEl) {
    if (status === 'connected') textEl.className = 'text-success';
    else if (status === 'syncing') textEl.className = 'text-warning';
    else if (status === 'error') textEl.className = 'text-danger';
    else textEl.className = 'text-secondary';
    textEl.innerText = text;
  }
  
  if (sidebarBtn) {
    const span = sidebarBtn.querySelector('span');
    if (span) span.innerText = text;
    if (status === 'connected') {
      sidebarBtn.style.color = 'var(--success)';
    } else if (status === 'error') {
      sidebarBtn.style.color = 'var(--danger)';
    } else {
      sidebarBtn.style.color = '';
    }
  }
}

async function syncWithCloud() {
  if (!supabaseClient) return;
  try {
    updateSyncStatus('syncing', 'Syncing...');

    // 0. Run queued deletions if any exist
    if (state.deletedIds && state.deletedIds.length > 0) {
      try {
        await supabaseClient.from('applications').delete().in('id', state.deletedIds);
        state.deletedIds = [];
        localStorage.setItem('oasis_track_state', JSON.stringify(state));
      } catch (err) {
        console.error('Failed to flush queued deletions:', err);
      }
    }
    
    const { data: supaApps, error: appsError } = await supabaseClient.from('applications').select('*');
    const { data: supaActivities, error: actsError } = await supabaseClient.from('activities').select('*');
    
    // Graceful fetch for Resumes table
    let supaResumes = [];
    let hasResumesTable = false;
    try {
      const { data: resData, error: resError } = await supabaseClient.from('resumes').select('*');
      if (!resError) {
        supaResumes = resData || [];
        hasResumesTable = true;
      }
    } catch(e) {
      console.warn("Resumes table not set up on Supabase yet.");
    }
    
    if (appsError) throw appsError;
    if (actsError) throw actsError;
    
    let mergedApps = [...state.applications];
    let needsUpload = [];
    
    if (supaApps) {
      supaApps.forEach(sApp => {
        // Skip items currently in deletion queue
        if (state.deletedIds && state.deletedIds.includes(sApp.id)) return;

        try {
          if (typeof sApp.contacts === 'string') sApp.contacts = JSON.parse(sApp.contacts);
          if (typeof sApp.timeline === 'string') sApp.timeline = JSON.parse(sApp.timeline);
        } catch(e) {}

        const localIndex = mergedApps.findIndex(a => a.id === sApp.id);
        if (localIndex === -1) {
          mergedApps.push(sApp);
        } else {
          const localApp = mergedApps[localIndex];
          const sDate = new Date(sApp.lastUpdated || 0);
          const lDate = new Date(localApp.lastUpdated || 0);
          if (sDate > lDate) {
            mergedApps[localIndex] = sApp;
          } else if (lDate > sDate) {
            needsUpload.push(localApp);
          }
        }
      });
    }
    
    state.applications.forEach(lApp => {
      const hasServer = supaApps && supaApps.some(s => s.id === lApp.id);
      if (!hasServer) {
        needsUpload.push(lApp);
      }
    });
    
    if (needsUpload.length > 0) {
      const uploadPayload = needsUpload.map(app => ({
        ...app,
        contacts: typeof app.contacts === 'object' ? JSON.stringify(app.contacts) : app.contacts,
        timeline: typeof app.timeline === 'object' ? JSON.stringify(app.timeline) : app.timeline
      }));
      const { error: upsertError } = await supabaseClient.from('applications').upsert(uploadPayload);
      if (upsertError) throw upsertError;
    }
    
    let mergedActivities = [...state.activities];
    if (supaActivities) {
      supaActivities.forEach(sAct => {
        if (!mergedActivities.some(a => a.id === sAct.id)) {
          mergedActivities.push(sAct);
        }
      });
    }
    
    const newActivities = state.activities.filter(lAct => !supaActivities || !supaActivities.some(s => s.id === lAct.id));
    if (newActivities.length > 0) {
      const { error: actUpsertError } = await supabaseClient.from('activities').upsert(newActivities);
      if (actUpsertError) throw actUpsertError;
    }

    // Merge resumes if table exists
    if (hasResumesTable) {
      let mergedResumes = [...state.resumes];
      let resUpload = [];
      
      supaResumes.forEach(sRes => {
        if (!mergedResumes.some(r => r.id === sRes.id)) {
          mergedResumes.push(sRes);
        }
      });
      
      state.resumes.forEach(lRes => {
        if (!supaResumes.some(s => s.id === lRes.id)) {
          resUpload.push(lRes);
        }
      });
      
      if (resUpload.length > 0) {
        const { error: resUpsertError } = await supabaseClient.from('resumes').upsert(resUpload);
        if (resUpsertError) throw resUpsertError;
      }
      state.resumes = mergedResumes;
    }
    
    state.applications = mergedApps;
    state.activities = mergedActivities.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    localStorage.setItem('oasis_track_state', JSON.stringify(state));
    updateSyncStatus('connected', 'Cloud Synced');
    
    renderDashboard();
    renderBoard();
    renderList();
    renderResumes();
    renderStats();
  } catch (err) {
    console.error('Cloud sync failure:', err);
    updateSyncStatus('error', 'Sync failed');
  }
}

// DOM Elements & Setup
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  initSupabase();
  setupEventListeners();
  initApp();
  if (supabaseClient) {
    syncWithCloud();
  }
});

// Load state from localStorage
function loadState() {
  const local = localStorage.getItem('oasis_track_state');
  if (local) {
    try {
      state = JSON.parse(local);
      if (!state.columns) state.columns = DEMO_DATA.columns;
      if (!state.applications) state.applications = [];
      if (!state.activities) state.activities = [];
      
      // Clean up old demo applications and activities automatically
      state.applications = state.applications.filter(a => !a.id.startsWith('demo-'));
      state.activities = state.activities.filter(act => !act.id.startsWith('act'));

      if (!state.resumes) {
        state.resumes = [
          { id: 'res-default-1', name: 'Martech Consultant Resume', target: 'Marketing Tech roles', url: 'https://drive.google.com/file/d/1example1/view' },
          { id: 'res-default-2', name: 'Marketing Analytics CV', target: 'Analytics roles', url: 'https://drive.google.com/file/d/1example2/view' }
        ];
      }
    } catch (e) {
      state = DEMO_DATA;
    }
  } else {
    state = DEMO_DATA;
    if (!state.resumes || state.resumes.length === 0) {
      state.resumes = [
        { id: 'res-default-1', name: 'Martech Consultant Resume', target: 'Marketing Tech roles', url: 'https://drive.google.com/file/d/1example1/view' },
        { id: 'res-default-2', name: 'Marketing Analytics CV', target: 'Analytics roles', url: 'https://drive.google.com/file/d/1example2/view' }
      ];
    }
    saveState();
  }
}

// Save state to localStorage
function saveState() {
  localStorage.setItem('oasis_track_state', JSON.stringify(state));
  if (supabaseClient) {
    syncWithCloud();
  }
}

// Theme handling
function initTheme() {
  const body = document.body;
  if (state.theme === 'light') {
    body.classList.add('light-theme');
    document.getElementById('theme-icon').setAttribute('data-lucide', 'moon');
  } else {
    body.classList.remove('light-theme');
    document.getElementById('theme-icon').setAttribute('data-lucide', 'sun');
  }
  lucide.createIcons();
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  saveState();
  initTheme();
}

// Global Search
let searchTimeout;
function handleSearch(query) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    renderBoard(query);
    renderList(query);
  }, 150);
}

// Keyboard shortcuts: ⌘K or Ctrl+K triggers search focus
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    document.getElementById('global-search').focus();
  }
});

// App Initiation
function initApp() {
  initTheme();
  renderDashboard();
  renderBoard();
  renderList();
  renderResumes();
  renderStats();
  lucide.createIcons();
}

function setupEventListeners() {
  // Tab Navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
      
      const tabId = item.getAttribute('data-tab');
      item.classList.add('active');
      document.getElementById(`tab-${tabId}`).classList.add('active');
      
      if (tabId === 'stats') {
        renderStats();
      }
    });
  });

  // Theme Toggle
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // Search input
  document.getElementById('global-search').addEventListener('input', (e) => {
    handleSearch(e.target.value);
  });

  // View toggle
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const view = btn.getAttribute('data-view');
      if (view === 'kanban') {
        document.getElementById('kanban-view').style.display = 'flex';
        document.getElementById('list-view').style.display = 'none';
      } else {
        document.getElementById('kanban-view').style.display = 'none';
        document.getElementById('list-view').style.display = 'block';
        renderList();
      }
    });
  });

  // New Application
  document.getElementById('btn-new-app').addEventListener('click', () => {
    const newApp = {
      id: 'app-' + Date.now(),
      company: 'New Company',
      role: 'Martech Consultant',
      stage: state.columns[0] || 'Wishlist',
      priority: 3,
      source: '',
      location: '',
      salary: '',
      link: '',
      resume: '',
      notes: '',
      contacts: [],
      timeline: [{ id: 't-' + Date.now(), date: new Date().toISOString().split('T')[0], text: 'Created application' }],
      lastUpdated: new Date().toISOString()
    };
    state.applications.push(newApp);
    addActivity(`Created Application for ${newApp.company}`);
    saveState();
    initApp();
    openDrawer(newApp.id);
  });

  // Add Column / Stage
  document.getElementById('btn-add-column').addEventListener('click', () => {
    const stageName = prompt('Enter new stage name:');
    if (stageName && !state.columns.includes(stageName)) {
      state.columns.push(stageName);
      saveState();
      initApp();
    }
  });

  // Drawer events
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  document.getElementById('drawer-overlay').addEventListener('click', closeDrawer);

  // Delete App button
  document.getElementById('btn-delete-app').addEventListener('click', async () => {
    const appId = document.getElementById('job-drawer').getAttribute('data-app-id');
    if (appId && confirm('Are you sure you want to delete this application?')) {
      const app = state.applications.find(a => a.id === appId);
      
      // Filter out application locally
      state.applications = state.applications.filter(a => a.id !== appId);
      
      // Track deleted ID to prevent pulling it back from cloud
      if (!state.deletedIds) state.deletedIds = [];
      state.deletedIds.push(appId);
      
      addActivity(`Deleted Application for ${app ? app.company : 'unknown'}`);
      
      // Delete from Supabase immediately if connected
      if (supabaseClient) {
        try {
          await supabaseClient.from('applications').delete().eq('id', appId);
          // Remove from queue on success
          state.deletedIds = state.deletedIds.filter(id => id !== appId);
        } catch (err) {
          console.error('Failed to delete app from Supabase:', err);
        }
      }
      
      saveState();
      closeDrawer();
      initApp();
    }
  });

  // Drawer Tabs
  document.querySelectorAll('.drawer-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.drawer-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.drawer-tab-pane').forEach(p => p.classList.remove('active'));
      
      btn.classList.add('active');
      const paneId = btn.getAttribute('data-drawer-tab');
      document.getElementById(`pane-${paneId}`).classList.add('active');
    });
  });

  // Drawer Fields Auto-saving (on blur & inputs)
  const autoSaveFields = ['edit-company', 'edit-role', 'edit-stage', 'edit-source', 'edit-location', 'edit-salary', 'edit-link', 'edit-notes'];
  autoSaveFields.forEach(fieldId => {
    document.getElementById(fieldId).addEventListener('change', () => saveDrawerData(fieldId));
  });

  // Priority stars
  document.querySelectorAll('#edit-priority span').forEach(star => {
    star.addEventListener('click', () => {
      const priority = parseInt(star.getAttribute('data-star'));
      updateStars(priority);
      const appId = document.getElementById('job-drawer').getAttribute('data-app-id');
      const app = state.applications.find(a => a.id === appId);
      if (app && app.priority !== priority) {
        app.priority = priority;
        app.lastUpdated = new Date().toISOString();
        saveState();
        renderBoard();
        renderList();
      }
    });
  });

  // Add timeline manual event
  document.getElementById('btn-add-timeline-event').addEventListener('click', () => {
    const input = document.getElementById('new-timeline-note');
    const text = input.value.trim();
    const appId = document.getElementById('job-drawer').getAttribute('data-app-id');
    if (text && appId) {
      const app = state.applications.find(a => a.id === appId);
      if (app) {
        app.timeline.unshift({
          id: 't-' + Date.now(),
          date: new Date().toISOString().split('T')[0],
          text: text
        });
        app.lastUpdated = new Date().toISOString();
        saveState();
        input.value = '';
        renderDrawerTimeline(app);
      }
    }
  });

  // Add HR contact
  document.getElementById('btn-add-contact').addEventListener('click', () => {
    const appId = document.getElementById('job-drawer').getAttribute('data-app-id');
    const app = state.applications.find(a => a.id === appId);
    if (app) {
      app.contacts.push({
        id: 'c-' + Date.now(),
        name: 'New Contact',
        email: '',
        phone: '',
        linkedin: '',
        notes: ''
      });
      app.lastUpdated = new Date().toISOString();
      saveState();
      renderDrawerContacts(app);
    }
  });

  // Export Data
  document.getElementById('export-btn').addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `linear_track_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  });

  // Import Data
  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });

  document.getElementById('import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const importedState = JSON.parse(e.target.result);
        if (importedState.applications) {
          state = importedState;
          saveState();
          initApp();
          alert('Data imported successfully!');
        } else {
          alert('Invalid file format.');
        }
      } catch (err) {
        alert('Error parsing JSON.');
      }
    };
    reader.readAsText(file);
  });

  // Cloud Sync Settings Modal Events
  const cloudOverlay = document.getElementById('cloud-modal-overlay');
  const cloudModal = document.getElementById('cloud-sync-modal');
  const inputUrl = document.getElementById('input-supa-url');
  const inputKey = document.getElementById('input-supa-key');

  document.getElementById('btn-cloud-settings').addEventListener('click', () => {
    // Load current values
    inputUrl.value = localStorage.getItem('oasis_supa_url') || '';
    inputKey.value = localStorage.getItem('oasis_supa_key') || '';
    
    // Show sync status text
    if (supabaseClient) {
      updateSyncStatus('connected', 'Connected & Active');
    } else {
      updateSyncStatus('disconnected', 'Not connected');
    }

    cloudOverlay.classList.add('active');
    cloudModal.classList.add('active');
  });

  const closeCloudModal = () => {
    cloudOverlay.classList.remove('active');
    cloudModal.classList.remove('active');
  };

  document.getElementById('cloud-modal-close').addEventListener('click', closeCloudModal);
  document.getElementById('btn-cloud-cancel').addEventListener('click', closeCloudModal);

  document.getElementById('btn-cloud-save').addEventListener('click', async () => {
    const url = inputUrl.value.trim();
    const key = inputKey.value.trim();
    
    if (!url || !key) {
      alert('Please fill out both Project URL and Anon API key.');
      return;
    }

    localStorage.setItem('oasis_supa_url', url);
    localStorage.setItem('oasis_supa_key', key);
    
    updateSyncStatus('syncing', 'Connecting to Supabase...');

    const connected = initSupabase();
    if (connected) {
      await syncWithCloud();
      closeCloudModal();
      alert('Supabase connected successfully! Data synchronized.');
    } else {
      alert('Could not initialize Supabase. Check your Project URL and Key.');
    }
  });

  document.getElementById('btn-cloud-disconnect').addEventListener('click', () => {
    if (confirm('Are you sure you want to disconnect from Cloud Sync? Local data will remain on this device.')) {
      localStorage.removeItem('oasis_supa_url');
      localStorage.removeItem('oasis_supa_key');
      supabaseClient = null;
      updateSyncStatus('disconnected', 'Cloud Sync');
      closeCloudModal();
      initApp();
    }
  });

  // Resume Bank Event Listeners
  document.getElementById('btn-add-resume').addEventListener('click', () => {
    const newRes = {
      id: 'res-' + Date.now(),
      name: 'New Resume Version',
      target: 'Target roles',
      url: ''
    };
    state.resumes.push(newRes);
    saveState();
    renderResumes();
  });
}

// Activity Feed Logger
function addActivity(text) {
  state.activities.unshift({
    id: 'act-' + Date.now(),
    text: text,
    date: new Date().toISOString()
  });
  // Keep last 15 activities
  if (state.activities.length > 15) {
    state.activities.pop();
  }
}

// Focus Summary Calculator (surfaces active / critical items)
function getFocusList() {
  const focus = [];
  const now = new Date();
  
  state.applications.forEach(app => {
    const lastUpdate = new Date(app.lastUpdated);
    const diffDays = Math.floor((now - lastUpdate) / (1000 * 60 * 60 * 24));
    
    // Alert: Interview Scheduled
    if (app.stage.toLowerCase() === 'interview') {
      focus.push({
        id: app.id,
        type: 'interview',
        text: `Interview for ${app.company} (${app.role})`,
        icon: 'calendar',
        colorClass: 'text-success'
      });
    }
    
    // Alert: No activity for 7 days
    if (diffDays >= 7 && app.stage.toLowerCase() === 'applied') {
      focus.push({
        id: app.id,
        type: 'followup',
        text: `Follow up with ${app.company} (no updates for ${diffDays} days)`,
        icon: 'clock',
        colorClass: 'text-warning'
      });
    }
    
    // Offer alerts
    if (app.stage.toLowerCase() === 'offer') {
      focus.push({
        id: app.id,
        type: 'offer',
        text: `Review offer from ${app.company}!`,
        icon: 'award',
        colorClass: 'text-success'
      });
    }
  });
  
  return focus;
}

// Render Dashboard
function renderDashboard() {
  const activeCount = state.applications.filter(a => ['applied', 'interview'].includes(a.stage.toLowerCase())).length;
  const interviewCount = state.applications.filter(a => a.stage.toLowerCase() === 'interview').length;
  const followups = getFocusList().filter(f => f.type === 'followup').length;
  const offersCount = state.applications.filter(a => a.stage.toLowerCase() === 'offer').length;

  document.getElementById('stat-active').innerText = activeCount;
  document.getElementById('stat-interviews').innerText = interviewCount;
  document.getElementById('stat-followups').innerText = followups;
  document.getElementById('stat-offers').innerText = offersCount;

  // Render Weekly Chart on Dashboard Homescreen
  renderWeeklyChart('dashboard-chart');

  // Focus Summary panel
  const focusContainer = document.getElementById('dashboard-focus');
  const focusItems = getFocusList();
  
  focusContainer.innerHTML = '';
  if (focusItems.length === 0) {
    focusContainer.innerHTML = `
      <div style="text-align: center; padding: 24px 0; color: var(--text-muted);">
        <p style="font-size: 15px; margin-bottom: 8px;">Everything's up to date.</p>
        <blockquote style="font-style: italic; font-size: 13px;">"The hiring market remains gloriously chaotic, but at least your tracker isn't."</blockquote>
      </div>
    `;
  } else {
    focusItems.forEach(item => {
      focusContainer.innerHTML += `
        <div class="focus-item" onclick="openDrawer('${item.id}')">
          <i data-lucide="${item.icon}" class="focus-item-icon ${item.colorClass}"></i>
          <span class="focus-item-content">${item.text}</span>
          <i data-lucide="chevron-right" style="width: 14px; height: 14px; margin-left: auto;"></i>
        </div>
      `;
    });
  }

  // Sidebar Today's Focus count & list
  document.getElementById('focus-count').innerText = focusItems.length;
  const sidebarFocusList = document.getElementById('focus-list');
  sidebarFocusList.innerHTML = '';
  focusItems.slice(0, 4).forEach(item => {
    sidebarFocusList.innerHTML += `
      <div class="focus-item" onclick="openDrawer('${item.id}')">
        <span class="focus-item-content">${item.text}</span>
      </div>
    `;
  });
}

// Render Board (Kanban)
function renderBoard(filterQuery = '') {
  const board = document.getElementById('kanban-view');
  board.innerHTML = '';
  
  state.columns.forEach(col => {
    const colId = `col-${col.replace(/\s+/g, '-').toLowerCase()}`;
    const colApps = state.applications.filter(app => {
      const matchStage = app.stage === col;
      if (!matchStage) return false;
      if (!filterQuery) return true;
      const q = filterQuery.toLowerCase();
      return (
        app.company.toLowerCase().includes(q) ||
        app.role.toLowerCase().includes(q) ||
        app.location.toLowerCase().includes(q) ||
        app.source.toLowerCase().includes(q)
      );
    });

    const columnHTML = `
      <div class="kanban-column" id="${colId}" ondragover="allowDrop(event)" ondrop="drop(event, '${col}')">
        <div class="kanban-column-header">
          <div class="kanban-column-title-group">
            <span class="column-title" contenteditable="true" onblur="renameColumn('${col}', this.innerText)">${col}</span>
            <span class="column-count">${colApps.length}</span>
          </div>
          <button class="btn-icon column-menu-btn" onclick="deleteColumn('${col}')">
            <i data-lucide="trash" style="width:14px; height:14px;"></i>
          </button>
        </div>
        <div class="kanban-cards">
          ${colApps.map(app => `
            <div class="kanban-card" draggable="true" ondragstart="drag(event, '${app.id}')" onclick="openDrawer('${app.id}')">
              <div class="card-header">
                <span class="card-company">${app.company}</span>
                <span class="card-priority">
                  ${'<i data-lucide="star" style="fill: currentColor;"></i>'.repeat(app.priority)}
                </span>
              </div>
              <div class="card-role">${app.role}</div>
              <div class="card-footer">
                <span class="card-tag">${app.location || 'Remote'}</span>
                <span>${new Date(app.lastUpdated).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    board.innerHTML += columnHTML;
  });
  lucide.createIcons();
}

// Drag & Drop Mechanics
function allowDrop(e) {
  e.preventDefault();
}

function drag(e, appId) {
  e.dataTransfer.setData("text/plain", appId);
}

function drop(e, stageName) {
  e.preventDefault();
  const appId = e.dataTransfer.getData("text/plain");
  const app = state.applications.find(a => a.id === appId);
  if (app && app.stage !== stageName) {
    const oldStage = app.stage;
    app.stage = stageName;
    app.lastUpdated = new Date().toISOString();
    app.timeline.unshift({
      id: 't-' + Date.now(),
      date: new Date().toISOString().split('T')[0],
      text: `Moved stage from ${oldStage} to ${stageName}`
    });
    addActivity(`Moved ${app.company} to ${stageName}`);
    saveState();
    initApp();
  }
}

// Column settings: Rename / Delete
window.renameColumn = function(oldName, newName) {
  newName = newName.trim();
  if (!newName || newName === oldName) return;
  
  const index = state.columns.indexOf(oldName);
  if (index !== -1) {
    state.columns[index] = newName;
    state.applications.forEach(app => {
      if (app.stage === oldName) app.stage = newName;
    });
    saveState();
    initApp();
  }
}

window.deleteColumn = function(colName) {
  if (confirm(`Are you sure you want to delete stage "${colName}"? Applications in this stage will be kept and moved to the first stage.`)) {
    state.columns = state.columns.filter(c => c !== colName);
    const targetStage = state.columns[0] || 'Wishlist';
    state.applications.forEach(app => {
      if (app.stage === colName) {
        app.stage = targetStage;
      }
    });
    saveState();
    initApp();
  }
}

// Render List View
function renderList(filterQuery = '') {
  const tbody = document.getElementById('list-table-body');
  tbody.innerHTML = '';

  const filteredApps = state.applications.filter(app => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      app.company.toLowerCase().includes(q) ||
      app.role.toLowerCase().includes(q) ||
      app.stage.toLowerCase().includes(q) ||
      app.location.toLowerCase().includes(q)
    );
  });

  if (filteredApps.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">No applications found.</td></tr>`;
    return;
  }

  filteredApps.forEach(app => {
    tbody.innerHTML += `
      <tr onclick="openDrawer('${app.id}')">
        <td data-label="Company" style="font-weight: 600;">${app.company}</td>
        <td data-label="Role">${app.role}</td>
        <td data-label="Stage"><span class="badge">${app.stage}</span></td>
        <td data-label="Priority" style="color: var(--warning);">
          ${'★'.repeat(app.priority)}${'☆'.repeat(5 - app.priority)}
        </td>
        <td data-label="Location">${app.location || 'N/A'}</td>
        <td data-label="Salary">${app.salary || 'N/A'}</td>
        <td data-label="Last Updated">${new Date(app.lastUpdated).toLocaleDateString()}</td>
      </tr>
    `;
  });
}

// Drawer: Open details side drawer
function openDrawer(appId) {
  const app = state.applications.find(a => a.id === appId);
  if (!app) return;

  const drawer = document.getElementById('job-drawer');
  drawer.setAttribute('data-app-id', appId);

  // Bind values
  document.getElementById('edit-company').value = app.company;
  document.getElementById('edit-role').value = app.role;
  document.getElementById('edit-source').value = app.source || '';
  document.getElementById('edit-location').value = app.location || '';
  document.getElementById('edit-salary').value = app.salary || '';
  document.getElementById('edit-link').value = app.link || '';
  // Load resumes dropdown options
  const resumeSelect = document.getElementById('edit-resume');
  resumeSelect.innerHTML = '<option value="">None / Manual Text</option>';
  state.resumes.forEach(res => {
    const opt = document.createElement('option');
    opt.value = res.id;
    opt.innerText = res.name;
    if (res.id === app.resume || res.name === app.resume) opt.selected = true;
    resumeSelect.appendChild(opt);
  });

  const updateResumeLink = () => {
    const selectedId = resumeSelect.value;
    const viewBtn = document.getElementById('link-view-resume');
    const matched = state.resumes.find(r => r.id === selectedId);
    if (matched && matched.url) {
      viewBtn.href = matched.url;
      viewBtn.style.display = 'inline-flex';
    } else {
      viewBtn.style.display = 'none';
    }
  };

  updateResumeLink();
  resumeSelect.onchange = () => {
    app.resume = resumeSelect.value;
    app.lastUpdated = new Date().toISOString();
    saveState();
    updateResumeLink();
  };

  document.getElementById('edit-notes').value = app.notes || '';

  // Load stages list
  const stageSelect = document.getElementById('edit-stage');
  stageSelect.innerHTML = '';
  state.columns.forEach(col => {
    const opt = document.createElement('option');
    opt.value = col;
    opt.innerText = col;
    if (col === app.stage) opt.selected = true;
    stageSelect.appendChild(opt);
  });

  updateStars(app.priority);
  renderDrawerTimeline(app);
  renderDrawerContacts(app);

  // Open Drawer UI
  document.getElementById('drawer-overlay').classList.add('active');
  drawer.classList.add('active');
  document.body.style.overflow = 'hidden';
  lucide.createIcons();
}

function closeDrawer() {
  document.getElementById('drawer-overlay').classList.remove('active');
  document.getElementById('job-drawer').classList.remove('active');
  document.body.style.overflow = '';
  initApp();
}

// Drawer updates & autosave
function saveDrawerData(fieldId) {
  const appId = document.getElementById('job-drawer').getAttribute('data-app-id');
  const app = state.applications.find(a => a.id === appId);
  if (!app) return;

  const val = document.getElementById(fieldId).value;
  switch (fieldId) {
    case 'edit-company':
      app.company = val;
      break;
    case 'edit-role':
      app.role = val;
      break;
    case 'edit-stage':
      const old = app.stage;
      if (old !== val) {
        app.stage = val;
        app.timeline.unshift({
          id: 't-' + Date.now(),
          date: new Date().toISOString().split('T')[0],
          text: `Moved stage to ${val}`
        });
        addActivity(`Moved ${app.company} to ${val}`);
      }
      break;
    case 'edit-source':
      app.source = val;
      break;
    case 'edit-location':
      app.location = val;
      break;
    case 'edit-salary':
      app.salary = val;
      break;
    case 'edit-link':
      app.link = val;
      break;
    case 'edit-resume':
      app.resume = val;
      break;
    case 'edit-notes':
      app.notes = val;
      break;
  }

  app.lastUpdated = new Date().toISOString();
  saveState();
}

function updateStars(priority) {
  document.querySelectorAll('#edit-priority span').forEach(star => {
    const starVal = parseInt(star.getAttribute('data-star'));
    if (starVal <= priority) {
      star.classList.add('active');
    } else {
      star.classList.remove('active');
    }
  });
}

// Render Timeline inside Drawer
function renderDrawerTimeline(app) {
  const list = document.getElementById('timeline-list');
  list.innerHTML = '';
  
  if (!app.timeline || app.timeline.length === 0) {
    list.innerHTML = `<p class="subtitle" style="margin:0;">No timeline events recorded.</p>`;
    return;
  }

  app.timeline.forEach(event => {
    list.innerHTML += `
      <div class="timeline-item">
        <div class="timeline-dot"></div>
        <div class="timeline-date">${event.date}</div>
        <div class="timeline-text">${event.text}</div>
      </div>
    `;
  });
}

// Render & Manage Contacts inside Drawer
function renderDrawerContacts(app) {
  const list = document.getElementById('contacts-list');
  list.innerHTML = '';

  if (!app.contacts || app.contacts.length === 0) {
    list.innerHTML = `<p class="subtitle" style="margin: 0; padding-top: 8px;">No contacts added yet.</p>`;
    return;
  }

  app.contacts.forEach((contact, idx) => {
    list.innerHTML += `
        <button class="btn-delete-contact" onclick="deleteContact('${app.id}', '${contact.id}')" title="Delete Contact">
          <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
        </button>
        <div class="contact-row">
          <span class="contact-label">Name</span>
          <input type="text" class="input-flat" value="${contact.name}" onchange="updateContact('${app.id}', '${contact.id}', 'name', this.value)" />
        </div>
        <div class="contact-row">
          <span class="contact-label">Email</span>
          <input type="email" class="input-flat" value="${contact.email}" onchange="updateContact('${app.id}', '${contact.id}', 'email', this.value)" />
        </div>
        <div class="contact-row">
          <span class="contact-label">Phone</span>
          <input type="tel" class="input-flat" value="${contact.phone}" onchange="updateContact('${app.id}', '${contact.id}', 'phone', this.value)" />
        </div>
        <div class="contact-row">
          <span class="contact-label">LinkedIn</span>
          <input type="url" class="input-flat" value="${contact.linkedin}" onchange="updateContact('${app.id}', '${contact.id}', 'linkedin', this.value)" />
        </div>
      </div>
    `;
  });
  lucide.createIcons();
}

window.updateContact = function(appId, contactId, field, value) {
  const app = state.applications.find(a => a.id === appId);
  if (app) {
    const contact = app.contacts.find(c => c.id === contactId);
    if (contact) {
      contact[field] = value;
      app.lastUpdated = new Date().toISOString();
      saveState();
    }
  }
};

window.deleteContact = function(appId, contactId) {
  const app = state.applications.find(a => a.id === appId);
  if (app) {
    app.contacts = app.contacts.filter(c => c.id !== contactId);
    app.lastUpdated = new Date().toISOString();
    saveState();
    renderDrawerContacts(app);
  }
};

// Statistics Calculations
function renderStats() {
  const apps = state.applications;
  const total = apps.length;
  const interviews = apps.filter(a => a.timeline && a.timeline.some(t => t.text.toLowerCase().includes('interview') || t.text.toLowerCase().includes('round'))).length;
  const offers = apps.filter(a => a.stage.toLowerCase() === 'offer').length;
  
  // Calculate Response Rate: (Interviews + Offers + Rejections) / Total
  const responseCount = apps.filter(a => ['interview', 'offer', 'rejected'].includes(a.stage.toLowerCase()) || (a.timeline && a.timeline.length > 1)).length;
  const responseRate = total > 0 ? Math.round((responseCount / total) * 100) : 0;
  const offerRate = total > 0 ? Math.round((offers / total) * 100 * 10) / 10 : 0;

  // Ghosted count: Applied with no update for > 14 days
  const now = new Date();
  const ghostedCount = apps.filter(a => {
    if (a.stage.toLowerCase() !== 'applied') return false;
    const diff = (now - new Date(a.lastUpdated)) / (1000 * 60 * 60 * 24);
    return diff >= 14;
  }).length;

  // Bind raw numbers to health badges
  document.getElementById('badge-total').innerText = total;
  document.getElementById('badge-interviews').innerText = interviews;
  document.getElementById('badge-offers').innerText = offers;
  document.getElementById('badge-ghosted').innerText = ghostedCount;

  // Render Gauges (Circumference is 2 * PI * r(34) = ~213.6)
  document.getElementById('val-response').innerText = `${responseRate}%`;
  document.getElementById('fill-response').style.strokeDashoffset = 213.6 - (213.6 * responseRate / 100);

  document.getElementById('val-offer').innerText = `${offerRate}%`;
  document.getElementById('fill-offer').style.strokeDashoffset = 213.6 - (213.6 * offerRate / 100);

  // Render Stage Distribution Bars
  const funnelContainer = document.getElementById('funnel-distribution');
  if (funnelContainer) {
    funnelContainer.innerHTML = '';
    state.columns.forEach(col => {
      const count = apps.filter(a => a.stage === col).length;
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      funnelContainer.innerHTML += `
        <div class="funnel-row">
          <span class="funnel-stage-name">${col}</span>
          <div class="funnel-bar-wrapper">
            <div class="funnel-bar-fill" style="width: ${pct}%"></div>
          </div>
          <span class="funnel-stage-count">${count} <small class="text-secondary">(${pct}%)</small></span>
        </div>
      `;
    });
  }

  // Draw Area chart
  renderWeeklyChart();
}

function renderWeeklyChart(svgId = 'weekly-chart') {
  const svg = document.getElementById(svgId);
  if (!svg) return;

  const gradientId = svgId === 'dashboard-chart' ? 'dashboardChartGradient' : 'chartGradient';

  svg.innerHTML = `
    <defs>
      <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.3"></stop>
        <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.0"></stop>
      </linearGradient>
    </defs>
  `;

  // Get last 6 weeks momentum
  const weeks = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    weeks.push({
      label: `W-${i}`,
      count: 0,
      timestamp: start
    });
  }

  state.applications.forEach(app => {
    const createdDate = new Date(app.lastUpdated);
    for (let i = 5; i >= 0; i--) {
      const wStart = weeks[i].timestamp;
      const wEnd = new Date(wStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      if (createdDate >= wStart && createdDate < wEnd) {
        weeks[i].count++;
        break;
      }
    }
  });

  const maxVal = Math.max(...weeks.map(w => w.count), 4);
  const width = 600;
  const height = 220;
  const padding = 40;

  // Grid lines
  for (let i = 0; i <= 4; i++) {
    const y = padding + (height - 2 * padding) * (i / 4);
    const labelVal = Math.round(maxVal - (maxVal * (i / 4)));
    svg.innerHTML += `
      <line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}" stroke="var(--border-color)" stroke-width="1" />
      <text x="${padding - 10}" y="${y + 4}" fill="var(--text-muted)" font-size="10" font-weight="600" text-anchor="end">${labelVal}</text>
    `;
  }

  const points = [];
  weeks.forEach((w, idx) => {
    const x = padding + (width - 2 * padding) * (idx / 5);
    const y = height - padding - (height - 2 * padding) * (w.count / maxVal);
    points.push({ x, y, label: w.label });
  });

  const pathD = `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ');
  const areaD = `${pathD} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;

  // Draw Area fill
  svg.innerHTML += `
    <path d="${areaD}" fill="url(#${gradientId})" />
  `;

  // Draw Line
  svg.innerHTML += `
    <path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" />
  `;

  // Draw points & labels
  points.forEach(p => {
    svg.innerHTML += `
      <circle cx="${p.x}" cy="${p.y}" r="4" fill="var(--bg-panel)" stroke="var(--accent)" stroke-width="2" />
      <text x="${p.x}" y="${height - 15}" fill="var(--text-secondary)" font-size="10" font-weight="600" text-anchor="middle">${p.label}</text>
    `;
  });
}

// Resume Bank Renderer & Field Updates
function renderResumes() {
  const list = document.getElementById('resumes-list');
  if (!list) return;
  list.innerHTML = '';
  
  if (!state.resumes || state.resumes.length === 0) {
    list.innerHTML = `<p class="subtitle" style="text-align: center; padding: 24px 0;">No resumes added to the bank yet. Click 'Add Resume' to store your first resume.</p>`;
    return;
  }
  
  state.resumes.forEach(res => {
    let uploadLabel = 'Upload File';
    if (res.url) {
      if (res.url.startsWith('data:')) uploadLabel = 'Local File';
      else if (res.url.includes('supabase.co')) uploadLabel = 'Cloud File';
    }

    list.innerHTML += `
      <div class="resume-card">
        <div>
          <input type="text" class="input-flat" value="${res.name}" onchange="updateResumeField('${res.id}', 'name', this.value)" style="font-weight: 700; font-size: 15px; padding: 4px; border-radius: 4px; width: 100%;" />
          <div class="resume-card-meta">
            <span class="text-secondary" style="font-weight: 500;">Target:</span>
            <input type="text" class="input-flat" value="${res.target}" onchange="updateResumeField('${res.id}', 'target', this.value)" style="padding: 2px 4px; width: 180px; border-radius: 4px;" />
            <span class="text-secondary" style="font-weight: 500;">Link:</span>
            <input type="url" class="input-flat" value="${res.url || ''}" onchange="updateResumeField('${res.id}', 'url', this.value)" placeholder="Google Drive URL or File URL" style="padding: 2px 4px; width: 260px; border-radius: 4px;" />
            <span class="text-secondary" style="font-weight: 500;">Or File:</span>
            <input type="file" id="file-${res.id}" accept=".pdf,.doc,.docx" onchange="uploadResumeFile('${res.id}', this.files)" style="display: none;" />
            <button class="btn btn-secondary btn-sm" onclick="document.getElementById('file-${res.id}').click()" style="padding: 4px 8px; border-radius: 4px; display: inline-flex; align-items: center; gap: 6px;">
              <i data-lucide="upload-cloud" style="width: 12px; height: 12px;"></i>
              <span>${uploadLabel}</span>
            </button>
          </div>
        </div>
        <div class="resume-card-actions">
          ${res.url ? `
            <a href="${res.url}" target="_blank" class="btn btn-secondary btn-icon" title="Open / View Link" style="padding: 8px; display: inline-flex; align-items: center; justify-content: center;">
              <i data-lucide="external-link" style="width: 14px; height: 14px;"></i>
            </a>
            <a href="${res.url}" download="${res.name}" class="btn btn-secondary btn-icon" title="Download File" style="padding: 8px; display: inline-flex; align-items: center; justify-content: center;">
              <i data-lucide="download" style="width: 14px; height: 14px;"></i>
            </a>
          ` : ''}
          <button class="btn btn-secondary btn-icon" onclick="deleteResume('${res.id}')" title="Delete Resume" style="color: var(--danger); padding: 8px; display: inline-flex; align-items: center; justify-content: center;">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
          </button>
        </div>
      </div>
    `;
  });
  lucide.createIcons();
}

window.uploadResumeFile = async function(resId, files) {
  if (files.length === 0) return;
  const file = files[0];
  const resObj = state.resumes.find(r => r.id === resId);
  if (!resObj) return;

  if (supabaseClient) {
    try {
      updateSyncStatus('syncing', 'Uploading...');
      const fileExt = file.name.split('.').pop();
      const fileName = `${resId}_${Date.now()}.${fileExt}`;
      const filePath = `public/${fileName}`;

      const { data, error } = await supabaseClient.storage
        .from('resumes')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true
        });

      if (error) throw error;

      const { data: { publicUrl } } = supabaseClient.storage
        .from('resumes')
        .getPublicUrl(filePath);

      resObj.url = publicUrl;
      saveState();
      renderResumes();
      alert('Resume file uploaded successfully to Supabase Storage!');
    } catch (err) {
      console.error('Supabase storage upload failed:', err);
      alert('Cloud upload failed (ensure your resumes storage bucket is created and set to public in Supabase). Storing locally instead: ' + err.message);
      
      // Fallback to local Base64 storage if cloud bucket upload failed
      storeLocalBase64(file, resObj);
    }
  } else {
    storeLocalBase64(file, resObj);
  }
};

function storeLocalBase64(file, resObj) {
  const reader = new FileReader();
  reader.onload = function(e) {
    resObj.url = e.target.result;
    saveState();
    renderResumes();
    alert('Resume file stored locally in browser storage!');
  };
  reader.readAsDataURL(file);
}

window.updateResumeField = function(resId, field, value) {
  const res = state.resumes.find(r => r.id === resId);
  if (res) {
    res[field] = value.trim();
    saveState();
    const drawer = document.getElementById('job-drawer');
    if (drawer && drawer.classList.contains('active')) {
      const resumeSelect = document.getElementById('edit-resume');
      if (resumeSelect && resumeSelect.value === resId) {
        const viewBtn = document.getElementById('link-view-resume');
        if (viewBtn) {
          viewBtn.href = res.url;
          viewBtn.style.display = res.url ? 'inline-flex' : 'none';
        }
      }
    }
  }
};

window.deleteResume = function(resId) {
  if (confirm('Are you sure you want to delete this resume? Jobs referencing this resume will fall back to default.')) {
    state.resumes = state.resumes.filter(r => r.id !== resId);
    saveState();
    renderResumes();
  }
};


