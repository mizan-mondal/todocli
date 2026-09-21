/**
 * todocli Minimalist Terminal Controller
 */

const API_BASE = 'http://localhost:8080/api';
let currentUser = localStorage.getItem('todocli_user') || 'guest';
let tasks = [];
let commandHistory = JSON.parse(localStorage.getItem('todocli_history') || '[]');
let historyIndex = -1;
let isBackendOnline = false;

// DOM Elements
const cliInput = document.getElementById('cli-input');
const terminalHistory = document.getElementById('terminal-history');
const promptUser = document.getElementById('prompt-user');
const terminalScreen = document.getElementById('terminal-screen');

document.addEventListener('DOMContentLoaded', () => {
  updateUser(currentUser);
  checkBackendHealth();
  loadLocalTasks();

  // Focus input automatically and on any screen click
  cliInput.focus();
  document.addEventListener('click', () => {
    cliInput.focus();
  });

  cliInput.addEventListener('keydown', handleKeydown);
});

function updateUser(username) {
  currentUser = username;
  localStorage.setItem('todocli_user', username);
  if (promptUser) {
    promptUser.textContent = `${username}@todocli`;
  }
}

async function checkBackendHealth() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${API_BASE}/tasks?username=${encodeURIComponent(currentUser)}`, {
      signal: controller.signal
    });
    clearTimeout(timer);
    if (res.ok) {
      isBackendOnline = true;
      const data = await res.json();
      if (Array.isArray(data)) {
        tasks = data;
      }
      return;
    }
  } catch (e) {
    // Offline, fallback to local
  }
  isBackendOnline = false;
}

function loadLocalTasks() {
  const saved = localStorage.getItem(`todocli_tasks_${currentUser}`);
  if (saved) {
    try {
      tasks = JSON.parse(saved);
    } catch (e) {
      tasks = [];
    }
  } else {
    tasks = [];
  }
}

function saveLocalTasks() {
  localStorage.setItem(`todocli_tasks_${currentUser}`, JSON.stringify(tasks));
}

function handleKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    executeCommand();
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
    handleAutocomplete();
  } else if (e.ctrlKey && e.key === 'l') {
    e.preventDefault();
    terminalHistory.innerHTML = '';
  }
}

const COMMANDS = ['help', 'add', 'list', 'ls', 'done', 'check', 'delete', 'rm', 'user', 'status', 'clear', 'cls'];
function handleAutocomplete() {
  const val = cliInput.value.trim().toLowerCase();
  if (!val) return;
  const match = COMMANDS.find(c => c.startsWith(val));
  if (match) {
    cliInput.value = match + ' ';
  }
}

async function executeCommand() {
  const raw = cliInput.value.trim();
  if (!raw) return;

  commandHistory.push(raw);
  if (commandHistory.length > 100) commandHistory.shift();
  localStorage.setItem('todocli_history', JSON.stringify(commandHistory));
  historyIndex = -1;
  cliInput.value = '';

  const parts = raw.split(/\s+/);
  const action = parts[0].toLowerCase();
  const arg = parts.slice(1).join(' ').trim();

  // Clear command
  if (action === 'clear' || action === 'cls') {
    terminalHistory.innerHTML = '';
    window.scrollTo(0, document.body.scrollHeight);
    return;
  }

  // User switch
  if (action === 'user') {
    if (!arg) {
      appendHistory(raw, 'Usage: user <username>', 'error');
      return;
    }
    updateUser(arg);
    loadLocalTasks();
    checkBackendHealth();
    appendHistory(raw, `Switched user to @${arg}`, 'success');
    return;
  }

  // Backend execution if online
  if (isBackendOnline) {
    try {
      const res = await fetch(`${API_BASE}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: raw, username: currentUser })
      });
      if (res.ok) {
        const data = await res.json();
        appendHistory(raw, data.output || '', data.success ? 'success' : 'error');
        if (data.tasks) tasks = data.tasks;
        return;
      }
    } catch (e) {
      isBackendOnline = false;
    }
  }

  // Local command fallback
  executeLocal(raw, action, arg);
}

function executeLocal(raw, action, arg) {
  switch (action) {
    case 'help':
      const help = [
        'todocli commands:',
        '  add <task_name>     - Add a new task',
        '  list / ls           - List all tasks',
        '  done <task_id>      - Mark task as completed',
        '  delete <task_id>    - Remove a task',
        '  user <username>     - Switch user context',
        '  status              - View system & storage info',
        '  clear               - Clear terminal screen',
        '  help                - Show this help manual'
      ].join('\n');
      appendHistory(raw, help);
      break;

    case 'add':
      if (!arg) {
        appendHistory(raw, 'Error: Task description cannot be empty. Usage: add <task_name>', 'error');
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
      tasks.push(newTask);
      saveLocalTasks();
      appendHistory(raw, `✔ Task #${nextId} created: "${arg}"`, 'success');
      break;

    case 'list':
    case 'ls':
      if (tasks.length === 0) {
        appendHistory(raw, `No tasks found for @${currentUser}. Use 'add <task>' to create one.`);
        return;
      }
      const lines = [`Tasks for @${currentUser}:`];
      tasks.forEach(t => {
        const status = t.completed ? '[DONE]' : '[TODO]';
        lines.push(`  #${String(t.id).padEnd(3)} ${status.padEnd(6)} ${t.taskName}`);
      });
      appendHistory(raw, lines.join('\n'));
      break;

    case 'done':
    case 'check':
      if (!arg) {
        appendHistory(raw, 'Usage: done <task_id>', 'error');
        return;
      }
      const doneId = parseInt(arg, 10);
      const target = tasks.find(t => t.id === doneId);
      if (target) {
        target.completed = true;
        saveLocalTasks();
        appendHistory(raw, `✔ Task #${doneId} completed: "${target.taskName}"`, 'success');
      } else {
        appendHistory(raw, `Error: Task #${arg} not found.`, 'error');
      }
      break;

    case 'delete':
    case 'rm':
      if (!arg) {
        appendHistory(raw, 'Usage: delete <task_id>', 'error');
        return;
      }
      const delId = parseInt(arg, 10);
      const exists = tasks.some(t => t.id === delId);
      if (exists) {
        tasks = tasks.filter(t => t.id !== delId);
        saveLocalTasks();
        appendHistory(raw, `✔ Task #${delId} deleted.`, 'success');
      } else {
        appendHistory(raw, `Error: Task #${arg} not found.`, 'error');
      }
      break;

    case 'status':
      const pending = tasks.filter(t => !t.completed).length;
      const done = tasks.filter(t => t.completed).length;
      const stat = [
        `Status:       ONLINE (${isBackendOnline ? 'Spring Boot API' : 'Standalone Local Storage'})`,
        `Active User:  @${currentUser}`,
        `Total Tasks:  ${tasks.length} (${pending} pending, ${done} completed)`
      ].join('\n');
      appendHistory(raw, stat);
      break;

    default:
      appendHistory(raw, `Command not found: '${action}'. Type 'help' for available commands.`, 'error');
      break;
  }
}

function appendHistory(cmd, output, type = '') {
  const entry = document.createElement('div');
  entry.className = 'history-entry';
  
  entry.innerHTML = `
    <div class="history-command">
      <span class="history-prompt">${currentUser}@todocli:~$</span>
      <span class="history-cmd-text">${escapeHtml(cmd)}</span>
    </div>
    ${output ? `<div class="history-output ${type}">${escapeHtml(output)}</div>` : ''}
  `;
  
  terminalHistory.appendChild(entry);
  window.scrollTo(0, document.body.scrollHeight);
}

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
