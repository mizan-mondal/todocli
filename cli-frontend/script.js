/**
 * todocli — Web-Based Command-Line Interface Task Manager
 * Supports:
 * 1. Independent per-command authentication: `<username> <password> <operation> [args...]`
 * 2. Optional login/session authentication: `<username> <password> login` & `<username> <password> logout`
 *    - Saves session credentials in browser localStorage so future visits remain authenticated.
 *    - When logged in, simplified shortcut commands can be used (`list`, `add task <name>`, `delete task <num>`, `logout`, `whoami`).
 */

const API_BASE = 'http://localhost:8080/api';
const SESSION_STORAGE_KEY = 'todocli_session';

let commandHistory = JSON.parse(localStorage.getItem('todocli_history') || '[]');
let historyIndex = -1;
let isBackendOnline = false;

// DOM Elements
const cliInput = document.getElementById('cli-input');
const terminalHistory = document.getElementById('terminal-history');

document.addEventListener('DOMContentLoaded', () => {
  updatePrompt();
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

// Session Management Helpers (Browser persistence)
function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveSession(session) {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch (e) {}
  updatePrompt();
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (e) {}
  updatePrompt();
}

function updatePrompt() {
  const session = getSession();
  const promptUser = document.getElementById('prompt-user');
  if (promptUser) {
    promptUser.textContent = session && session.username ? session.username : 'todocli';
  }
}

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

function handleAutocomplete() {
  const val = cliInput.value.trim().toLowerCase();
  if (!val) return;

  const session = getSession();
  const available = session
    ? ['help', 'clear', 'cls', 'list', 'add task ', 'delete task ', 'logout', 'whoami']
    : ['help', 'clear', 'cls', 'create', 'login', 'logout', 'list', 'add task ', 'delete task '];

  const match = available.find(c => c.startsWith(val));
  if (match) {
    cliInput.value = match;
  }
}

function getHelpText() {
  return [
    'todocli Commands:',
    '  <username> <password> create                   - Register a new account',
    '  <username> <password> login                    - Log in and save session in browser',
    '  <username> <password> logout                   - Log out and clear session',
    '  <username> <password> list                     - List all tasks',
    '  <username> <password> add task <task_name>     - Add a new task',
    '  <username> <password> delete task <task_number>- Delete a task by number',
    '',
    'When Logged In (Shortcut Commands):',
    '  list                                           - List your tasks',
    '  add task <task_name>                           - Add a new task',
    '  delete task <task_number>                      - Delete a task by number',
    '  whoami                                         - Show current logged-in user',
    '  logout                                         - Log out and clear session',
    '',
    'Utilities:',
    '  clear / cls                                    - Clear terminal screen',
    '  help                                           - Display this manual'
  ].join('\n');
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

  const session = getSession();
  const activePrompt = session && session.username ? `${session.username}:~$` : 'todocli:~$';

  if (lower === 'help') {
    appendHistory(raw, getHelpText(), '', activePrompt);
    return;
  }

  if (lower === 'whoami') {
    if (session && session.username) {
      appendHistory(raw, `Logged in as '${session.username}'.`, '', activePrompt);
    } else {
      appendHistory(raw, 'Not logged in. Use \'<username> <password> login\' to log in.', '', activePrompt);
    }
    return;
  }

  // Parse command tokens
  const tokens = raw.split(/\s+/);
  const firstTokenLower = tokens[0].toLowerCase();

  // Handle shortcut commands when logged in or typed without credentials
  let commandToSend = raw;
  const isShortcut = ['list', 'add', 'delete', 'logout'].includes(firstTokenLower);

  if (isShortcut) {
    if (!session) {
      appendHistory(
        raw,
        'Error: Invalid command format.\nEvery command must start with: <username> <password> <operation> ...\nOr log in first using: <username> <password> login\nType \'help\' for available commands.',
        'error',
        activePrompt
      );
      return;
    }
    // Expand shortcut command with logged-in user credentials
    commandToSend = `${session.username} ${session.password} ${raw}`;
  }

  // Attempt execution on backend service
  if (isBackendOnline) {
    try {
      const res = await fetch(`${API_BASE}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: commandToSend })
      });
      if (res.ok) {
        const data = await res.json();

        // Handle login / logout session side effects if successful
        const sentTokens = commandToSend.split(/\s+/);
        if (sentTokens.length >= 3) {
          const op = sentTokens[2].toLowerCase();
          if (data.success) {
            if (op === 'login') {
              saveSession({ username: sentTokens[0], password: sentTokens[1] });
            } else if (op === 'logout') {
              clearSession();
            }
          }
        }

        appendHistory(raw, data.output || '', data.success ? 'success' : 'error', activePrompt);
        return;
      }
    } catch (e) {
      isBackendOnline = false;
    }
  }

  // Fallback to local execution engine
  await executeLocal(commandToSend, raw, activePrompt);
}

/**
 * Local Execution Engine (Fallback matching backend behavior)
 */
async function executeLocal(commandToRun, displayCmd, activePrompt) {
  const lower = commandToRun.toLowerCase();

  if (lower === 'help') {
    appendHistory(displayCmd, getHelpText(), '', activePrompt);
    return;
  }

  // Parse command: username password <operation> [args...]
  const tokens = commandToRun.split(/\s+/);
  if (tokens.length < 3) {
    appendHistory(
      displayCmd,
      'Error: Invalid command format.\nEvery command must start with: <username> <password> <operation> ...\nOr log in first using: <username> <password> login\nType \'help\' for available commands.',
      'error',
      activePrompt
    );
    return;
  }

  const username = tokens[0];
  const password = tokens[1];
  const operation = tokens[2].toLowerCase();
  const remainderTokens = tokens.slice(3);

  // Account creation
  if (operation === 'create') {
    const users = getLocalUsers();
    if (users[username]) {
      appendHistory(displayCmd, `Error: User '${username}' already exists.`, 'error', activePrompt);
      return;
    }

    const salt = generateHexSalt();
    const hash = await hashPassword(password, salt);
    users[username] = { salt, hash, createdAt: new Date().toISOString() };
    saveLocalUsers(users);

    appendHistory(displayCmd, `User '${username}' created successfully.`, 'success', activePrompt);
    return;
  }

  // Authenticate user credentials
  const users = getLocalUsers();
  const user = users[username];
  if (!user) {
    appendHistory(displayCmd, 'Authentication failed: Invalid username or password.', 'error', activePrompt);
    return;
  }

  const computedHash = await hashPassword(password, user.salt);
  if (computedHash !== user.hash) {
    appendHistory(displayCmd, 'Authentication failed: Invalid username or password.', 'error', activePrompt);
    return;
  }

  // Execute authenticated operations
  switch (operation) {
    case 'login': {
      saveSession({ username, password });
      appendHistory(displayCmd, `User '${username}' logged in successfully.`, 'success', activePrompt);
      break;
    }

    case 'logout': {
      clearSession();
      appendHistory(displayCmd, `User '${username}' logged out successfully.`, 'success', activePrompt);
      break;
    }

    case 'list': {
      const tasks = getLocalTasks(username);
      if (tasks.length === 0) {
        appendHistory(displayCmd, `No tasks found for user '${username}'.`, '', activePrompt);
        return;
      }
      const lines = tasks.map((t, idx) => `${idx + 1}. ${t.taskName}`);
      appendHistory(displayCmd, lines.join('\n'), '', activePrompt);
      break;
    }

    case 'add': {
      if (remainderTokens.length === 0) {
        appendHistory(displayCmd, 'Error: Missing sub-command. Usage: <username> <password> add task <task_name>', 'error', activePrompt);
        return;
      }
      const subCmd = remainderTokens[0].toLowerCase();
      if (subCmd !== 'task') {
        appendHistory(displayCmd, `Error: Unknown sub-command '${remainderTokens[0]}'. Usage: <username> <password> add task <task_name>`, 'error', activePrompt);
        return;
      }
      const taskName = remainderTokens.slice(1).join(' ').trim();
      if (!taskName) {
        appendHistory(displayCmd, 'Error: Task description cannot be empty. Usage: <username> <password> add task <task_name>', 'error', activePrompt);
        return;
      }

      const tasks = getLocalTasks(username);
      tasks.push({
        id: Date.now(),
        taskName,
        createdAt: new Date().toISOString()
      });
      saveLocalTasks(username, tasks);
      appendHistory(displayCmd, `Task added: "${taskName}"`, 'success', activePrompt);
      break;
    }

    case 'delete': {
      if (remainderTokens.length === 0) {
        appendHistory(displayCmd, 'Error: Missing sub-command. Usage: <username> <password> delete task <task_number>', 'error', activePrompt);
        return;
      }
      const subCmd = remainderTokens[0].toLowerCase();
      if (subCmd !== 'task') {
        appendHistory(displayCmd, `Error: Unknown sub-command '${remainderTokens[0]}'. Usage: <username> <password> delete task <task_number>`, 'error', activePrompt);
        return;
      }
      const taskNumStr = remainderTokens[1];
      if (!taskNumStr) {
        appendHistory(displayCmd, 'Error: Missing task number. Usage: <username> <password> delete task <task_number>', 'error', activePrompt);
        return;
      }

      const taskNumber = parseInt(taskNumStr, 10);
      if (isNaN(taskNumber) || taskNumber < 1) {
        appendHistory(displayCmd, `Error: Invalid task number '${taskNumStr}'. Must be a positive integer.`, 'error', activePrompt);
        return;
      }

      const tasks = getLocalTasks(username);
      if (taskNumber > tasks.length) {
        appendHistory(displayCmd, `Error: Task #${taskNumber} not found. Use 'list' to view current tasks.`, 'error', activePrompt);
        return;
      }

      const deleted = tasks.splice(taskNumber - 1, 1)[0];
      saveLocalTasks(username, tasks);
      appendHistory(displayCmd, `Task #${taskNumber} deleted: "${deleted.taskName}"`, 'success', activePrompt);
      break;
    }

    default:
      appendHistory(
        displayCmd,
        `Error: Unknown operation '${operation}'. Allowed operations: create, login, logout, list, add task, delete task. Type 'help' for usage.`,
        'error',
        activePrompt
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

function appendHistory(cmd, output, type = '', promptLabel = null) {
  const entry = document.createElement('div');
  entry.className = 'history-entry';

  const session = getSession();
  const label = promptLabel || (session && session.username ? `${session.username}:~$` : 'todocli:~$');

  entry.innerHTML = `
    <div class="history-command">
      <span class="history-prompt">${escapeHtml(label)}</span>
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
