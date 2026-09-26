/**
 * todocli — Web-Based Command-Line Interface Task Manager
 * Powered by Supabase Postgres Cloud Database
 *
 * Design:
 * - Users & Tasks: Stored exclusively in Supabase (accessible from anywhere).
 * - Offline/Browser Storage: ONLY stores the login session credentials (`todocli_session`)
 *   when a user runs `<username> <password> login`, so they remain logged in across visits.
 */

import {
  isSupabaseConfigured,
  getSupabaseConfig,
  setSupabaseConfig,
  clearSupabaseConfig,
  dbCreateUser,
  dbAuthenticateUser,
  dbListTasks,
  dbAddTask,
  dbDeleteTask
} from './supabase.js';

const SESSION_STORAGE_KEY = 'todocli_session';
let commandHistory = JSON.parse(localStorage.getItem('todocli_history') || '[]');
let historyIndex = -1;

// DOM Elements
const cliInput = document.getElementById('cli-input');
const cliInputDisplay = document.getElementById('cli-input-display');
const terminalHistory = document.getElementById('terminal-history');

const NON_CREDENTIAL_COMMANDS = new Set([
  'help', 'clear', 'cls', 'whoami', 'config', 'supabase', 'list', 'ls', 'add', 'delete', 'logout'
]);

/**
 * Masks the password token with '*' characters for credential commands
 * (e.g. '<username> <password> <operation> ...' -> '<username> ******** <operation> ...')
 */
function maskCommand(raw) {
  if (!raw) return '';
  const match = raw.match(/^(\s*)(\S+)(\s+)(\S+)(.*)$/);
  if (!match) return raw;

  const [, leading, firstToken, sep, secondToken, rest] = match;
  if (NON_CREDENTIAL_COMMANDS.has(firstToken.toLowerCase())) {
    return raw;
  }

  return leading + firstToken + sep + '*'.repeat(secondToken.length) + rest;
}

function updateInputDisplay() {
  if (cliInputDisplay && cliInput) {
    cliInputDisplay.textContent = maskCommand(cliInput.value);
    cliInputDisplay.scrollLeft = cliInput.scrollLeft;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  updatePrompt();

  if (cliInput) {
    cliInput.focus();
    cliInput.addEventListener('keydown', handleKeydown);
    cliInput.addEventListener('input', updateInputDisplay);
    cliInput.addEventListener('scroll', () => {
      if (cliInputDisplay) cliInputDisplay.scrollLeft = cliInput.scrollLeft;
    });
    updateInputDisplay();
  }

  document.addEventListener('click', () => {
    if (cliInput) cliInput.focus();
  });
});

// Session Management Helpers (Browser persistence ONLY for login session)
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
      updateInputDisplay();
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (historyIndex > 0) {
      historyIndex--;
      cliInput.value = commandHistory[commandHistory.length - 1 - historyIndex] || '';
      updateInputDisplay();
    } else if (historyIndex === 0) {
      historyIndex = -1;
      cliInput.value = '';
      updateInputDisplay();
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
    ? ['help', 'clear', 'cls', 'list', 'ls', 'add task ', 'delete task ', 'logout', 'whoami', 'config supabase ']
    : ['help', 'clear', 'cls', 'create', 'login', 'logout', 'list', 'ls', 'add task ', 'delete task ', 'config supabase '];

  const match = available.find(c => c.startsWith(val));
  if (match) {
    cliInput.value = match;
    updateInputDisplay();
  }
}

function getHelpText() {
  return [
    'todocli Commands (Cloud-Synced via Supabase):',
    '  <username> <password> create                   - Register a new account in Supabase',
    '  <username> <password> login                    - Log in & store session offline in browser',
    '  <username> <password> logout                   - Log out & clear browser session',
    '  <username> <password> list / ls                - List all tasks from Supabase',
    '  <username> <password> add task <task_name>     - Add task to Supabase',
    '  <username> <password> delete task <task_number>- Delete task from Supabase',
    '',
    'When Logged In (Shortcut Commands):',
    '  list / ls                                      - List your tasks',
    '  add task <task_name>                           - Add a new task',
    '  delete task <task_number>                      - Delete task by number',
    '  whoami                                         - Show active logged-in user',
    '  logout                                         - Log out active session',
    '',
    'Configuration & Utilities:',
    '  config supabase <url> <anon_key>               - Set Supabase credentials',
    '  config supabase status                         - View Supabase connection status',
    '  config supabase clear                          - Clear stored browser Supabase credentials',
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
  updateInputDisplay();

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

  // Handle Supabase configuration commands
  if (lower.startsWith('config supabase') || lower === 'supabase status') {
    handleSupabaseConfigCommand(raw, activePrompt);
    return;
  }

  // Parse command tokens
  const tokens = raw.split(/\s+/);
  const firstTokenLower = tokens[0].toLowerCase();

  // Handle shortcut commands when logged in
  let commandToRun = raw;
  const isShortcut = ['list', 'ls', 'add', 'delete', 'logout'].includes(firstTokenLower);

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
    commandToRun = `${session.username} ${session.password} ${raw}`;
  }

  // Check if Supabase is configured before attempting database operations
  if (!isSupabaseConfigured()) {
    appendHistory(
      raw,
      'Error: Supabase is not configured.\n' +
      'Please add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file, OR\n' +
      'Run in terminal: config supabase <SUPABASE_URL> <SUPABASE_ANON_KEY>\n' +
      'See supabase/schema.sql for the database setup script.',
      'error',
      activePrompt
    );
    return;
  }

  await executeDatabaseCommand(commandToRun, raw, activePrompt);
}

function handleSupabaseConfigCommand(raw, activePrompt) {
  const parts = raw.split(/\s+/);

  // If "supabase status" or "config supabase" or "config supabase status"
  if (parts.length === 2 || (parts.length === 3 && parts[2].toLowerCase() === 'status')) {
    const config = getSupabaseConfig();
    if (config.url && config.key) {
      const maskedKey = config.key.length > 12 
        ? `${config.key.substring(0, 8)}...${config.key.substring(config.key.length - 4)}` 
        : '***';
      appendHistory(
        raw,
        `Supabase Configuration:\n  Status: Connected\n  URL: ${config.url}\n  Anon Key: ${maskedKey}\n  Source: ${config.source}`,
        'success',
        activePrompt
      );
    } else {
      appendHistory(
        raw,
        'Supabase Configuration:\n  Status: Not configured\n  Usage: config supabase <URL> <ANON_KEY>',
        'error',
        activePrompt
      );
    }
    return;
  }

  // "config supabase clear"
  if (parts.length === 3 && parts[2].toLowerCase() === 'clear') {
    clearSupabaseConfig();
    appendHistory(raw, 'Browser-stored Supabase credentials cleared.', 'success', activePrompt);
    return;
  }

  // "config supabase <url> <key>"
  if (parts.length >= 4) {
    const url = parts[2];
    const key = parts[3];
    try {
      new URL(url);
    } catch (e) {
      appendHistory(raw, `Error: '${url}' is not a valid URL. Example: https://xyz.supabase.co`, 'error', activePrompt);
      return;
    }

    setSupabaseConfig(url, key);
    appendHistory(
      raw,
      `Supabase configured successfully!\nConnected to: ${url}\nStored in browser configuration.`,
      'success',
      activePrompt
    );
    return;
  }

  appendHistory(raw, 'Usage: config supabase <URL> <ANON_KEY>\nOr: config supabase status\nOr: config supabase clear', 'error', activePrompt);
}

/**
 * Execute command against Supabase Database
 */
async function executeDatabaseCommand(commandToRun, displayCmd, activePrompt) {
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

  try {
    switch (operation) {
      case 'create': {
        const result = await dbCreateUser(username, password);
        appendHistory(displayCmd, result.message, result.success ? 'success' : 'error', activePrompt);
        break;
      }

      case 'login': {
        const auth = await dbAuthenticateUser(username, password);
        if (auth.success) {
          saveSession({ username, password });
          appendHistory(displayCmd, `User '${username}' logged in successfully.`, 'success', activePrompt);
        } else {
          appendHistory(displayCmd, auth.message, 'error', activePrompt);
        }
        break;
      }

      case 'logout': {
        clearSession();
        appendHistory(displayCmd, `User '${username}' logged out successfully.`, 'success', activePrompt);
        break;
      }

      case 'list':
      case 'ls': {
        const result = await dbListTasks(username, password);
        appendHistory(displayCmd, result.message, result.success ? '' : 'error', activePrompt);
        break;
      }

      case 'add': {
        if (remainderTokens.length === 0) {
          appendHistory(displayCmd, 'Error: Missing sub-command. Usage: add task <task_name>', 'error', activePrompt);
          return;
        }
        const subCmd = remainderTokens[0].toLowerCase();
        if (subCmd !== 'task') {
          appendHistory(displayCmd, `Error: Unknown sub-command '${remainderTokens[0]}'. Usage: add task <task_name>`, 'error', activePrompt);
          return;
        }
        const taskName = remainderTokens.slice(1).join(' ').trim();
        if (!taskName) {
          appendHistory(displayCmd, 'Error: Task description cannot be empty. Usage: add task <task_name>', 'error', activePrompt);
          return;
        }

        const result = await dbAddTask(username, password, taskName);
        appendHistory(displayCmd, result.message, result.success ? 'success' : 'error', activePrompt);
        break;
      }

      case 'delete': {
        if (remainderTokens.length === 0) {
          appendHistory(displayCmd, 'Error: Missing sub-command. Usage: delete task <task_number>', 'error', activePrompt);
          return;
        }
        const subCmd = remainderTokens[0].toLowerCase();
        if (subCmd !== 'task') {
          appendHistory(displayCmd, `Error: Unknown sub-command '${remainderTokens[0]}'. Usage: delete task <task_number>`, 'error', activePrompt);
          return;
        }
        const taskNumStr = remainderTokens[1];
        if (!taskNumStr) {
          appendHistory(displayCmd, 'Error: Missing task number. Usage: delete task <task_number>', 'error', activePrompt);
          return;
        }

        const taskNumber = parseInt(taskNumStr, 10);
        if (isNaN(taskNumber) || taskNumber < 1) {
          appendHistory(displayCmd, `Error: Invalid task number '${taskNumStr}'. Must be a positive integer.`, 'error', activePrompt);
          return;
        }

        const result = await dbDeleteTask(username, password, taskNumber);
        appendHistory(displayCmd, result.message, result.success ? 'success' : 'error', activePrompt);
        break;
      }

      default:
        appendHistory(
          displayCmd,
          `Error: Unknown operation '${operation}'. Allowed operations: create, login, logout, list, ls, add task, delete task. Type 'help' for usage.`,
          'error',
          activePrompt
        );
        break;
    }
  } catch (err) {
    appendHistory(displayCmd, `Database Error: ${err.message}`, 'error', activePrompt);
  }
}

function appendHistory(cmd, output, type = '', promptLabel = null) {
  const entry = document.createElement('div');
  entry.className = 'history-entry';

  const session = getSession();
  const label = promptLabel || (session && session.username ? `${session.username}:~$` : 'todocli:~$');

  const maskedCmd = maskCommand(cmd);

  entry.innerHTML = `
    <div class="history-command">
      <span class="history-prompt">${escapeHtml(label)}</span>
      <span class="history-cmd-text">${escapeHtml(maskedCmd)}</span>
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
