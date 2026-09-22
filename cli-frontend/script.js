/**
 * todocli — Web-Based Command-Line Interface Task Manager
 * Stateless Architecture: Every command contains `<username> <password> <operation>`
 */

const API_BASE = 'http://localhost:8080/api';
let commandHistory = JSON.parse(localStorage.getItem('todocli_history') || '[]');
let historyIndex = -1;
let isBackendOnline = false;

// DOM Elements
const cliInput = document.getElementById('cli-input');
const terminalHistory = document.getElementById('terminal-history');

document.addEventListener('DOMContentLoaded', () => {
  checkBackendHealth();

  // Focus input automatically and on any screen click
  if (cliInput) {
    cliInput.focus();
    cliInput.addEventListener('keydown', handleKeydown);
  }

  document.addEventListener('click', () => {
    if (cliInput) cliInput.focus();
  });
});

async function checkBackendHealth() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${API_BASE}/health`, {
      signal: controller.signal
    });
    clearTimeout(timer);
    if (res.ok) {
      isBackendOnline = true;
      return;
    }
  } catch (e) {
    // Offline, will fallback to local engine
  }
  isBackendOnline = false;
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

const GLOBAL_COMMANDS = ['help', 'clear', 'cls'];
function handleAutocomplete() {
  const val = cliInput.value.trim().toLowerCase();
  if (!val) return;
  const match = GLOBAL_COMMANDS.find(c => c.startsWith(val));
  if (match) {
    cliInput.value = match;
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

  const lower = raw.toLowerCase();

  // Instant screen clear
  if (lower === 'clear' || lower === 'cls') {
    terminalHistory.innerHTML = '';
    window.scrollTo(0, document.body.scrollHeight);
    return;
  }

  // Attempt execution on backend service
  if (isBackendOnline) {
    try {
      const res = await fetch(`${API_BASE}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: raw })
      });
      if (res.ok) {
        const data = await res.json();
        appendHistory(raw, data.output || '', data.success ? 'success' : 'error');
        return;
      }
    } catch (e) {
      isBackendOnline = false;
    }
  }

  // Fallback to local execution engine
  await executeLocal(raw);
}

/**
 * Local Execution Engine (Stateless fallback matching backend behavior)
 */
async function executeLocal(raw) {
  const lower = raw.toLowerCase();

  if (lower === 'help') {
    const help = [
      'todocli Commands:',
      '  <username> <password> create',
      '  <username> <password> list',
      '  <username> <password> add task <task_name>',
      '  <username> <password> delete task <task_number>',
      '',
      'Utilities:',
      '  clear / cls         - Clear terminal screen',
      '  help                - Display this manual'
    ].join('\n');
    appendHistory(raw, help);
    return;
  }

  // Parse command: username password <operation> [args...]
  const tokens = raw.split(/\s+/);
  if (tokens.length < 3) {
    appendHistory(
      raw,
      'Error: Invalid command format.\nEvery command must start with: <username> <password> <operation> ...\nType \'help\' for available commands.',
      'error'
    );
    return;
  }

  const username = tokens[0];
  const password = tokens[1];
  const operation = tokens[2].toLowerCase();
  const remainderTokens = tokens.slice(3);

  // Reject removed login command
  if (operation === 'login') {
    appendHistory(
      raw,
      'Error: The \'login\' command has been removed.\nEvery request is independently authenticated with \'<username> <password> <operation>\'.',
      'error'
    );
    return;
  }

  // Account creation
  if (operation === 'create') {
    const users = getLocalUsers();
    if (users[username]) {
      appendHistory(raw, `Error: User '${username}' already exists.`, 'error');
      return;
    }

    const salt = generateHexSalt();
    const hash = await hashPassword(password, salt);
    users[username] = { salt, hash, createdAt: new Date().toISOString() };
    saveLocalUsers(users);

    appendHistory(raw, `User '${username}' created successfully.`, 'success');
    return;
  }

  // Authenticate user credentials
  const users = getLocalUsers();
  const user = users[username];
  if (!user) {
    appendHistory(raw, 'Authentication failed: Invalid username or password.', 'error');
    return;
  }

  const computedHash = await hashPassword(password, user.salt);
  if (computedHash !== user.hash) {
    appendHistory(raw, 'Authentication failed: Invalid username or password.', 'error');
    return;
  }

  // Execute authenticated operations
  switch (operation) {
    case 'list': {
      const tasks = getLocalTasks(username);
      if (tasks.length === 0) {
        appendHistory(raw, `No tasks found for user '${username}'.`);
        return;
      }
      const lines = tasks.map((t, idx) => `${idx + 1}. ${t.taskName}`);
      appendHistory(raw, lines.join('\n'));
      break;
    }

    case 'add': {
      if (remainderTokens.length === 0) {
        appendHistory(raw, 'Error: Missing sub-command. Usage: <username> <password> add task <task_name>', 'error');
        return;
      }
      const subCmd = remainderTokens[0].toLowerCase();
      if (subCmd !== 'task') {
        appendHistory(raw, `Error: Unknown sub-command '${remainderTokens[0]}'. Usage: <username> <password> add task <task_name>`, 'error');
        return;
      }
      const taskName = remainderTokens.slice(1).join(' ').trim();
      if (!taskName) {
        appendHistory(raw, 'Error: Task description cannot be empty. Usage: <username> <password> add task <task_name>', 'error');
        return;
      }

      const tasks = getLocalTasks(username);
      tasks.push({
        id: Date.now(),
        taskName,
        createdAt: new Date().toISOString()
      });
      saveLocalTasks(username, tasks);
      appendHistory(raw, `Task added: "${taskName}"`, 'success');
      break;
    }

    case 'delete': {
      if (remainderTokens.length === 0) {
        appendHistory(raw, 'Error: Missing sub-command. Usage: <username> <password> delete task <task_number>', 'error');
        return;
      }
      const subCmd = remainderTokens[0].toLowerCase();
      if (subCmd !== 'task') {
        appendHistory(raw, `Error: Unknown sub-command '${remainderTokens[0]}'. Usage: <username> <password> delete task <task_number>`, 'error');
        return;
      }
      const taskNumStr = remainderTokens[1];
      if (!taskNumStr) {
        appendHistory(raw, 'Error: Missing task number. Usage: <username> <password> delete task <task_number>', 'error');
        return;
      }

      const taskNumber = parseInt(taskNumStr, 10);
      if (isNaN(taskNumber) || taskNumber < 1) {
        appendHistory(raw, `Error: Invalid task number '${taskNumStr}'. Must be a positive integer.`, 'error');
        return;
      }

      const tasks = getLocalTasks(username);
      if (taskNumber > tasks.length) {
        appendHistory(raw, `Error: Task #${taskNumber} not found. Use '${username} ${password} list' to view current tasks.`, 'error');
        return;
      }

      const deleted = tasks.splice(taskNumber - 1, 1)[0];
      saveLocalTasks(username, tasks);
      appendHistory(raw, `Task #${taskNumber} deleted: "${deleted.taskName}"`, 'success');
      break;
    }

    default:
      appendHistory(
        raw,
        `Error: Unknown operation '${operation}'. Allowed operations: create, list, add task, delete task. Type 'help' for usage.`,
        'error'
      );
      break;
  }
}

// Local Storage helpers
function getLocalUsers() {
  try {
    return JSON.parse(localStorage.getItem('todocli_users') || '{}');
  } catch (e) {
    return {};
  }
}

function saveLocalUsers(users) {
  localStorage.setItem('todocli_users', JSON.stringify(users));
}

function getLocalTasks(username) {
  try {
    return JSON.parse(localStorage.getItem(`todocli_tasks_${username}`) || '[]');
  } catch (e) {
    return [];
  }
}

function saveLocalTasks(username, tasks) {
  localStorage.setItem(`todocli_tasks_${username}`, JSON.stringify(tasks));
}

// Cryptography helpers (Salted SHA-256 using browser Web Crypto API)
function generateHexSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, hexSalt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + ':' + hexSalt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function appendHistory(cmd, output, type = '') {
  const entry = document.createElement('div');
  entry.className = 'history-entry';

  entry.innerHTML = `
    <div class="history-command">
      <span class="history-prompt">todocli:~$</span>
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
