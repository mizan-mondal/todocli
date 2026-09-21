/**
 * todocli Terminal Emulator & Task Controller
 */

// Configuration & State
const API_BASE = 'http://localhost:8080/api';
let currentUser = localStorage.getItem('todocli_user') || 'guest';
let tasks = [];
let commandHistory = JSON.parse(localStorage.getItem('todocli_history') || '[]');
let historyIndex = -1;
let currentFilter = 'all';
let isBackendOnline = false;

// DOM Elements
const cliInput = document.getElementById('cli-input');
const terminalOutput = document.getElementById('terminal-output');
const terminalBody = document.getElementById('terminal-body');
const taskList = document.getElementById('task-list');
const emptyState = document.getElementById('empty-state');
const serverStatus = document.getElementById('server-status');
const statusText = document.getElementById('status-text');
const currentUserNameEl = document.getElementById('current-user-name');
const windowUserLabel = document.getElementById('window-user-label');
const promptUser = document.querySelector('.prompt-user');
const taskCountBadge = document.getElementById('task-count-badge');
const statPending = document.getElementById('stat-pending');
const statCompleted = document.getElementById('stat-completed');
const statTotal = document.getElementById('stat-total');
const btnClearTerm = document.getElementById('btn-clear-term');
const btnToggleScanlines = document.getElementById('btn-toggle-scanlines');

// Initial Setup
document.addEventListener('DOMContentLoaded', () => {
  updateUserDisplay(currentUser);
  checkBackendHealth();
  setupEventListeners();
  loadInitialTasks();
});

// Update User UI
function updateUserDisplay(username) {
  currentUser = username;
  localStorage.setItem('todocli_user', username);
  if (currentUserNameEl) currentUserNameEl.textContent = username;
  if (windowUserLabel) windowUserLabel.textContent = `${username}@todocli`;
  if (promptUser) promptUser.textContent = username;
}

// Check Backend Connection
async function checkBackendHealth() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${API_BASE}/tasks?username=${encodeURIComponent(currentUser)}`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      isBackendOnline = true;
      serverStatus.className = 'server-status online';
      statusText.textContent = 'Spring Boot (Port 8080)';
      const serverTasks = await res.json();
      if (Array.isArray(serverTasks)) {
        tasks = serverTasks;
        renderTasks();
      }
      return;
    }
  } catch (err) {
    // Backend offline or unreachable
  }

  isBackendOnline = false;
  serverStatus.className = 'server-status offline';
  statusText.textContent = 'Local Standalone Mode';
}

// Load Initial Tasks (from LocalStorage fallback)
function loadInitialTasks() {
  if (tasks.length === 0) {
    const saved = localStorage.getItem(`todocli_tasks_${currentUser}`);
    if (saved) {
      try {
        tasks = JSON.parse(saved);
      } catch (e) {
        tasks = [];
      }
    } else {
      // Default initial welcome tasks
      tasks = [
        { id: 1, username: currentUser, taskName: 'Explore todocli terminal commands', completed: true, createdAt: new Date().toISOString() },
        { id: 2, username: currentUser, taskName: 'Type "add <task>" to create a new task', completed: false, createdAt: new Date().toISOString() },
        { id: 3, username: currentUser, taskName: 'Start Spring Boot backend in cli-backend/', completed: false, createdAt: new Date().toISOString() }
      ];
      saveLocalTasks();
    }
  }
  renderTasks();
}

function saveLocalTasks() {
  localStorage.setItem(`todocli_tasks_${currentUser}`, JSON.stringify(tasks));
}

// Event Listeners
function setupEventListeners() {
  // Input Command Execution & History
  cliInput.addEventListener('keydown', handleInputKeydown);

  // Quick Chips
  document.querySelectorAll('.quick-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const cmd = chip.getAttribute('data-cmd');
      if (cmd) {
        cliInput.value = cmd;
        executeInput();
      }
    });
  });

  // Filter Buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      currentFilter = e.currentTarget.getAttribute('data-filter');
      renderTasks();
    });
  });

  // Clear Terminal Button
  btnClearTerm.addEventListener('click', () => {
    terminalOutput.innerHTML = '';
    cliInput.focus();
  });

  // Scanlines Toggle
  btnToggleScanlines.addEventListener('click', () => {
    document.body.classList.toggle('scanlines');
  });

  // Terminal click to focus input
  terminalBody.addEventListener('click', (e) => {
    if (e.target !== cliInput && !e.target.closest('.action-btn') && !e.target.closest('.quick-chip')) {
      cliInput.focus();
    }
  });

  // Periodic health check
  setInterval(checkBackendHealth, 10000);
}

// Handle Command Line Key Events
function handleInputKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    executeInput();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (commandHistory.length > 0) {
      if (historyIndex < commandHistory.length - 1) {
        historyIndex++;
      }
      cliInput.value = commandHistory[commandHistory.length - 1 - historyIndex] || '';
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (historyIndex > 0) {
      historyIndex--;
      cliInput.value = commandHistory[commandHistory.length - 1 - historyIndex] || '';
    } else if (historyIndex === 0) {
      historyIndex = -1;
      cliInput.value = '';
    }
  } else if (e.key === 'Tab') {
    e.preventDefault();
    handleTabAutocomplete();
  } else if (e.ctrlKey && e.key === 'l') {
    e.preventDefault();
    terminalOutput.innerHTML = '';
  }
}

// Tab Autocomplete
const KNOWN_COMMANDS = ['help', 'add', 'list', 'ls', 'done', 'check', 'delete', 'rm', 'user', 'clear', 'cls', 'status'];
function handleTabAutocomplete() {
  const currentVal = cliInput.value.trim().toLowerCase();
  if (!currentVal) return;
  const match = KNOWN_COMMANDS.find(cmd => cmd.startsWith(currentVal));
  if (match) {
    cliInput.value = match + ' ';
  }
}

// Execute Command
async function executeInput() {
  const raw = cliInput.value.trim();
  if (!raw) return;

  // Add to History
  commandHistory.push(raw);
  if (commandHistory.length > 50) commandHistory.shift();
  localStorage.setItem('todocli_history', JSON.stringify(commandHistory));
  historyIndex = -1;

  cliInput.value = '';

  // Log prompt line
  appendCommandLog(raw);

  // Check special local commands
  const parts = raw.split(/\s+/);
  const action = parts[0].toLowerCase();
  const arg = parts.slice(1).join(' ').trim();

  if (action === 'clear' || action === 'cls') {
    terminalOutput.innerHTML = '';
    return;
  }

  if (action === 'user') {
    if (!arg) {
      appendResponseLog('Usage: user <username>', 'error');
      return;
    }
    updateUserDisplay(arg);
    loadInitialTasks();
    checkBackendHealth();
    appendResponseLog(`Switched active CLI user to @${arg}`, 'success');
    return;
  }

  // If backend is online, dispatch to Spring Boot API
  if (isBackendOnline) {
    try {
      const res = await fetch(`${API_BASE}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: raw, username: currentUser })
      });

      if (res.ok) {
        const data = await res.json();
        appendResponseLog(data.output || '', data.success ? 'success' : 'error');
        if (data.tasks) {
          tasks = data.tasks;
          renderTasks();
        }
        scrollTerminal();
        return;
      }
    } catch (err) {
      // If network failed during call, fallback to local execution
      isBackendOnline = false;
      serverStatus.className = 'server-status offline';
      statusText.textContent = 'Local Standalone Mode';
    }
  }

  // Local Mode Execution Engine
  executeLocally(action, arg);
  scrollTerminal();
}

// Local Execution Engine (when backend is not running)
function executeLocally(action, arg) {
  switch (action) {
    case 'help':
      const help = [
        'Available CLI Commands:',
        '  add <task_name>     - Add a new task',
        '  list / ls           - List all tasks for current user',
        '  done <task_id>      - Mark a task as completed',
        '  delete <task_id>    - Remove a task',
        '  user <username>     - Switch or set active user profile',
        '  status              - Check system & storage status',
        '  clear               - Clear terminal log',
        '  help                - Display this manual'
      ].join('\n');
      appendResponseLog(help, 'info');
      break;

    case 'add':
      if (!arg) {
        appendResponseLog('Error: Task description cannot be empty. Usage: add <task_name>', 'error');
        return;
      }
      const nextId = tasks.length > 0 ? Math.max(...tasks.map(t => t.id || 0)) + 1 : 1;
      const newTask = {
        id: nextId,
        username: currentUser,
        taskName: arg,
        completed: false,
        createdAt: new Date().toISOString()
      };
      tasks.unshift(newTask);
      saveLocalTasks();
      renderTasks();
      appendResponseLog(`✔ Task #${nextId} created: "${arg}" (assigned to @${currentUser})`, 'success');
      break;

    case 'list':
    case 'ls':
      if (tasks.length === 0) {
        appendResponseLog(`No tasks found for user @${currentUser}. Type "add <task>" to create one.`, 'info');
        return;
      }
      const listLines = [`Tasks for @${currentUser} (${tasks.length} total):`];
      tasks.forEach(t => {
        const mark = t.completed ? '[DONE]' : '[TODO]';
        listLines.push(`  #${String(t.id).padEnd(3)} ${mark.padEnd(6)} ${t.taskName}`);
      });
      appendResponseLog(listLines.join('\n'), 'info');
      break;

    case 'done':
    case 'check':
      if (!arg) {
        appendResponseLog('Usage: done <task_id>', 'error');
        return;
      }
      const doneId = parseInt(arg, 10);
      const targetDone = tasks.find(t => t.id === doneId);
      if (targetDone) {
        targetDone.completed = true;
        saveLocalTasks();
        renderTasks();
        appendResponseLog(`✔ Task #${doneId} marked as completed: "${targetDone.taskName}"`, 'success');
      } else {
        appendResponseLog(`Error: Task #${arg} not found.`, 'error');
      }
      break;

    case 'delete':
    case 'rm':
      if (!arg) {
        appendResponseLog('Usage: delete <task_id>', 'error');
        return;
      }
      const delId = parseInt(arg, 10);
      const exists = tasks.some(t => t.id === delId);
      if (exists) {
        tasks = tasks.filter(t => t.id !== delId);
        saveLocalTasks();
        renderTasks();
        appendResponseLog(`✔ Task #${delId} deleted successfully.`, 'success');
      } else {
        appendResponseLog(`Error: Task #${arg} not found.`, 'error');
      }
      break;

    case 'status':
      const pendingCount = tasks.filter(t => !t.completed).length;
      const completedCount = tasks.filter(t => t.completed).length;
      const statMsg = [
        'System Status: STANDALONE CLIENT (Local Mode)',
        `Active User:   @${currentUser}`,
        `Pending Tasks: ${pendingCount}`,
        `Completed:     ${completedCount}`,
        `Total:         ${tasks.length}`,
        'Tip: Run `mvn spring-boot:run` inside cli-backend/ to connect the Java Spring Boot backend.'
      ].join('\n');
      appendResponseLog(statMsg, 'info');
      break;

    default:
      appendResponseLog(`Unknown command: '${action}'. Type 'help' to see available commands.`, 'error');
      break;
  }
}

// Log Append Utilities
function appendCommandLog(cmd) {
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <div class="log-command-line">
      <span class="log-prompt">${currentUser}@todocli:~$</span>
      <span class="log-cmd-text">${escapeHtml(cmd)}</span>
    </div>
  `;
  terminalOutput.appendChild(entry);
}

function appendResponseLog(text, type = 'info') {
  const resp = document.createElement('div');
  resp.className = `log-response ${type}`;
  resp.textContent = text;
  terminalOutput.appendChild(resp);
}

function scrollTerminal() {
  terminalBody.scrollTop = terminalBody.scrollHeight;
}

// Render Task Deck
function renderTasks() {
  taskList.innerHTML = '';

  const filtered = tasks.filter(t => {
    if (currentFilter === 'pending') return !t.completed;
    if (currentFilter === 'completed') return t.completed;
    return true;
  });

  // Update Stats
  const total = tasks.length;
  const completed = tasks.filter(t => t.completed).length;
  const pending = total - completed;

  if (taskCountBadge) taskCountBadge.textContent = total;
  if (statTotal) statTotal.textContent = total;
  if (statCompleted) statCompleted.textContent = completed;
  if (statPending) statPending.textContent = pending;

  if (filtered.length === 0) {
    emptyState.style.display = 'flex';
  } else {
    emptyState.style.display = 'none';

    filtered.forEach(task => {
      const li = document.createElement('li');
      li.className = `task-item ${task.completed ? 'completed' : ''}`;
      
      const createdDate = task.createdAt ? new Date(task.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'today';

      li.innerHTML = `
        <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''} aria-label="Toggle task #${task.id}">
        <div class="task-content">
          <div>
            <span class="task-id-tag">#${task.id}</span>
            <span class="task-label">${escapeHtml(task.taskName)}</span>
          </div>
          <div class="task-meta">
            <span>@${escapeHtml(task.username || currentUser)}</span>
            <span>&bull;</span>
            <span>${createdDate}</span>
          </div>
        </div>
        <button class="task-delete-btn" title="Delete Task #${task.id}" aria-label="Delete Task #${task.id}">&times;</button>
      `;

      // Checkbox Toggle Event
      const checkbox = li.querySelector('.task-checkbox');
      checkbox.addEventListener('change', async () => {
        if (isBackendOnline) {
          try {
            const res = await fetch(`${API_BASE}/command`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ command: `done ${task.id}`, username: currentUser })
            });
            if (res.ok) {
              const data = await res.json();
              if (data.tasks) {
                tasks = data.tasks;
                renderTasks();
                return;
              }
            }
          } catch (e) {
            // fallback to local toggle
          }
        }
        task.completed = checkbox.checked;
        saveLocalTasks();
        renderTasks();
      });

      // Delete Button Event
      const deleteBtn = li.querySelector('.task-delete-btn');
      deleteBtn.addEventListener('click', async () => {
        if (isBackendOnline) {
          try {
            const res = await fetch(`${API_BASE}/command`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ command: `delete ${task.id}`, username: currentUser })
            });
            if (res.ok) {
              const data = await res.json();
              if (data.tasks) {
                tasks = data.tasks;
                renderTasks();
                return;
              }
            }
          } catch (e) {
            // fallback to local delete
          }
        }
        tasks = tasks.filter(t => t.id !== task.id);
        saveLocalTasks();
        renderTasks();
      });

      taskList.appendChild(li);
    });
  }
}

// Utility: HTML Escaping
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}
