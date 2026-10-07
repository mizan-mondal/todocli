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
  dbCreateUser,
  dbAuthenticateUser,
  dbListTasks,
  dbAddTask,
  dbDeleteTask,
  dbPriorityTask
} from './supabase.js';

const SESSION_STORAGE_KEY = 'todocli_session';
let commandHistory = JSON.parse(localStorage.getItem('todocli_history') || '[]');
let historyIndex = -1;

// DOM Elements
const cliInput = document.getElementById('cli-input');
const cliInputDisplay = document.getElementById('cli-input-display');
const terminalHistory = document.getElementById('terminal-history');

const NON_CREDENTIAL_COMMANDS = new Set([
  'help', 'clear', 'cls', 'whoami', 'list', 'ls', 'add', 'delete', 'priority', 'logout'
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
    ? ['help', 'clear', 'cls', 'list', 'ls', 'add task ', 'delete task ', 'priority ', 'logout', 'whoami']
    : ['help', 'clear', 'cls', 'create', 'login', 'logout', 'list', 'ls', 'add task ', 'delete task ', 'priority '];

  const match = available.find(c => c.startsWith(val));
  if (match) {
    cliInput.value = match;
    updateInputDisplay();
  }
}

function getHelpText() {
  return [
    'todocli Commands:',
    '  <username> <password> create                   - Register a new account',
    '  <username> <password> login                    - Log in and save session in browser',
    '  <username> <password> logout                   - Log out and clear session',
    '  <username> <password> list / ls                - List all tasks',
    '  <username> <password> add task <task_name>     - Add a new task',
    '  <username> <password> delete task <task_numbers>- Delete tasks by number (e.g. 1 or 1,2,5)',
    '  <username> <password> priority <from> to <to>  - Reorder task by moving to a new position',
    '',
    'When Logged In (Shortcut Commands):',
    '  list / ls                                      - List your tasks',
    '  add task <task_name>                           - Add a new task',
    '  delete task <task_numbers>                     - Delete tasks by number (e.g. 1 or 1,2,5)',
    '  priority <from> to <to>                        - Move task to new priority position',
    '  whoami                                         - Show active logged-in user',
    '  logout                                         - Log out active session',
    '',
    'Utilities:',
    '  clear / cls                                    - Clear terminal screen',
    '  help                                           - Display this manual'
  ].join('\n');
}

async function executeCommand() {
  const raw = cliInput.value.trim();
  if (!raw) return;

  // Mask credentials before persisting to command history to prevent local credential exposure
  commandHistory.push(maskCommand(raw));
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

  // Check if already logged in and trying to log in again
  if (session && session.username) {
    if (lower === 'login') {
      appendHistory(raw, `"${session.username}" already logged in !`, '', activePrompt);
      return;
    }
  }

  // Parse command tokens
  const tokens = raw.split(/\s+/);
  const firstTokenLower = tokens[0].toLowerCase();

  // If already logged in and attempting to login again with same username
  if (session && session.username && session.username.toLowerCase() === firstTokenLower) {
    if (tokens.length === 2 && tokens[1].toLowerCase() === 'login') {
      appendHistory(raw, `"${tokens[0]}" already logged in !`, '', activePrompt);
      return;
    }
    if (tokens.length >= 3 && tokens[2].toLowerCase() === 'login') {
      appendHistory(raw, `"${tokens[0]}" already logged in !`, '', activePrompt);
      return;
    }
  }

  // Handle shortcut commands when logged in
  let commandToRun = raw;
  const isShortcut = ['list', 'ls', 'add', 'delete', 'priority', 'logout'].includes(firstTokenLower);

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

  // Check if database service is configured before attempting operations
  if (!isSupabaseConfigured()) {
    appendHistory(
      raw,
      'Error: Database service is not configured.\n' +
      'Please configure environment variables in your deployment dashboard (e.g. Vercel) or contact administrator.',
      'error',
      activePrompt
    );
    return;
  }

  await executeDatabaseCommand(commandToRun, raw, activePrompt);
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
        const currentSession = getSession();
        if (currentSession && currentSession.username && currentSession.username.toLowerCase() === username.toLowerCase()) {
          appendHistory(displayCmd, `"${username}" already logged in !`, '', activePrompt);
          break;
        }

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
        const taskNumStr = remainderTokens.slice(1).join(' ').trim();
        if (!taskNumStr) {
          appendHistory(displayCmd, 'Error: Missing task number. Usage: delete task <task_number>', 'error', activePrompt);
          return;
        }

        const result = await dbDeleteTask(username, password, taskNumStr);
        appendHistory(displayCmd, result.message, result.success ? 'success' : 'error', activePrompt);
        break;
      }

      case 'priority': {
        const remainderStr = remainderTokens.join(' ').trim();
        if (!remainderStr) {
          appendHistory(
            displayCmd,
            'Error: Missing arguments for priority. Usage: <username> <password> priority <from_number> to <to_number>\nExample: priority 3 to 1',
            'error',
            activePrompt
          );
          return;
        }

        const priorityPattern = /^(\d+)\s+to\s+(\d+)$/i;
        const match = remainderStr.match(priorityPattern);

        if (!match) {
          appendHistory(
            displayCmd,
            'Error: Invalid priority format. Usage: <username> <password> priority <from_number> to <to_number>\nExample: priority 3 to 1',
            'error',
            activePrompt
          );
          return;
        }

        const fromNumber = parseInt(match[1], 10);
        const toNumber = parseInt(match[2], 10);

        if (fromNumber < 1 || toNumber < 1) {
          appendHistory(displayCmd, 'Error: Task numbers must be positive integers.', 'error', activePrompt);
          return;
        }

        const result = await dbPriorityTask(username, password, fromNumber, toNumber);
        appendHistory(displayCmd, result.message, result.success ? 'success' : 'error', activePrompt);
        break;
      }

      default:
        appendHistory(
          displayCmd,
          `Error: Unknown operation '${operation}'. Allowed operations: create, login, logout, list, ls, add task, delete task, priority. Type 'help' for usage.`,
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
