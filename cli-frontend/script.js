/**
 * todocli — Web-Based Command-Line Interface Task Manager
 * Standalone Browser Distribution with Supabase Postgres Cloud Database
 *
 * Design:
 * - Users & Tasks: Stored exclusively in Supabase (accessible from anywhere).
 * - Offline/Browser Storage: ONLY stores the login session credentials (`todocli_session`)
 *   when a user runs `<username> <password> login`, so they remain logged in across visits.
 */

const CONFIG_STORAGE_KEY = 'todocli_supabase_config';
const SESSION_STORAGE_KEY = 'todocli_session';

let supabaseClient = null;
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

function getSupabaseConfig() {
  try {
    const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.url && parsed.key) {
        return { url: parsed.url.trim(), key: parsed.key.trim() };
      }
    }
  } catch (e) {}
  return { url: '', key: '' };
}

function isSupabaseConfigured() {
  const config = getSupabaseConfig();
  return Boolean(config.url && config.key);
}

function getSupabase() {
  if (supabaseClient) return supabaseClient;
  const config = getSupabaseConfig();
  if (config.url && config.key && window.supabase && window.supabase.createClient) {
    supabaseClient = window.supabase.createClient(config.url, config.key);
    return supabaseClient;
  }
  return null;
}


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

  // Mask credentials before persisting to command history
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


  // Parse command tokens
  const tokens = raw.split(/\s+/);
  const firstTokenLower = tokens[0].toLowerCase();

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
    commandToRun = `${session.username} ${session.password} ${raw}`;
  }

  if (!isSupabaseConfigured()) {
    appendHistory(
      raw,
      'Error: Cloud database service is not configured.\n' +
      'Please configure environment variables in your deployment dashboard (e.g. Vercel) or contact administrator.',
      'error',
      activePrompt
    );
    return;
  }

  await executeDatabaseCommand(commandToRun, raw, activePrompt);
}


// Cryptography helpers (Salted SHA-256 using browser Web Crypto API)
const saltCache = new Map();

// =============================================================================
// Rate Limiting (Brute-Force & Abuse Protection)
// =============================================================================

const AUTH_RATE_LIMIT = {
  MAX_FAILED_ATTEMPTS: 5,
  WINDOW_MS: 60 * 1000,
  LOCKOUT_MS: 30 * 1000
};

const REQUEST_RATE_LIMIT = {
  MAX_REQUESTS: 20,
  WINDOW_MS: 10 * 1000
};

const authFailures = new Map();
const requestTimestamps = [];

function checkRequestRateLimit() {
  const now = Date.now();
  while (requestTimestamps.length > 0 && requestTimestamps[0] <= now - REQUEST_RATE_LIMIT.WINDOW_MS) {
    requestTimestamps.shift();
  }

  if (requestTimestamps.length >= REQUEST_RATE_LIMIT.MAX_REQUESTS) {
    const oldest = requestTimestamps[0];
    const waitSec = Math.max(1, Math.ceil((oldest + REQUEST_RATE_LIMIT.WINDOW_MS - now) / 1000));
    return {
      allowed: false,
      message: `Error: Rate limit exceeded. Too many requests. Please wait ${waitSec}s before trying again.`
    };
  }

  requestTimestamps.push(now);
  return { allowed: true };
}

function checkAuthRateLimit(username) {
  const cleanUser = username.trim().toLowerCase();
  const record = authFailures.get(cleanUser);
  if (!record) return { allowed: true };

  const now = Date.now();

  if (record.lockedUntil && record.lockedUntil > now) {
    const waitSec = Math.ceil((record.lockedUntil - now) / 1000);
    return {
      allowed: false,
      message: `Error: Rate limit exceeded for user '${username}'. Too many failed attempts. Try again in ${waitSec}s.`
    };
  }

  if (record.firstAttempt <= now - AUTH_RATE_LIMIT.WINDOW_MS) {
    authFailures.delete(cleanUser);
    return { allowed: true };
  }

  return { allowed: true };
}

function recordFailedAuth(username) {
  const cleanUser = username.trim().toLowerCase();
  const now = Date.now();
  let record = authFailures.get(cleanUser);

  if (!record || record.firstAttempt <= now - AUTH_RATE_LIMIT.WINDOW_MS) {
    record = { count: 1, firstAttempt: now, lockedUntil: null };
  } else {
    record.count += 1;
  }

  if (record.count >= AUTH_RATE_LIMIT.MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = now + AUTH_RATE_LIMIT.LOCKOUT_MS;
  }

  authFailures.set(cleanUser, record);
}

function resetAuthRateLimit(username) {
  const cleanUser = username.trim().toLowerCase();
  authFailures.delete(cleanUser);
}

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

async function fetchFrontendUserTasksLegacy(supabase, username) {
  let hasPosition = true;
  let { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, task_name, position, created_at')
    .eq('username', username)
    .order('position', { ascending: true })
    .order('id', { ascending: true });

  if (error && error.message && error.message.toLowerCase().includes('position')) {
    hasPosition = false;
    const fallback = await supabase
      .from('tasks')
      .select('id, task_name, created_at')
      .eq('username', username)
      .order('id', { ascending: true });
    tasks = fallback.data;
    error = fallback.error;
  }

  if (error) {
    throw new Error(`Database error while fetching tasks: ${error.message}`);
  }

  return { tasks: tasks || [], hasPosition };
}

async function dbCreateUser(username, password) {
  const reqCheck = checkRequestRateLimit();
  if (!reqCheck.allowed) return { success: false, message: reqCheck.message };

  const supabase = getSupabase();
  if (!supabase) throw new Error('Database service is not configured.');

  const cleanUser = username.trim();
  const salt = generateHexSalt();
  const hash = await hashPassword(password, salt);

  const { data, error } = await supabase.rpc('todocli_create_user', {
    p_username: cleanUser,
    p_password_hash: hash,
    p_password_salt: salt
  });

  if (error) {
    if (error.code === 'PGRST202' || error.message?.includes('function') || error.message?.includes('not found')) {
      return {
        success: false,
        message: 'Database setup required: Please run "supabase/schema.sql" in your Supabase SQL Editor to enable secure procedures and Row Level Security.'
      };
    }
    return { success: false, message: `Database error while creating user: ${error.message}` };
  }

  if (data && data.success) {
    saltCache.set(cleanUser, salt);
  }
  return data;
}

async function dbAuthenticateUser(username, password) {
  const cleanUser = username.trim();

  const authLimitCheck = checkAuthRateLimit(cleanUser);
  if (!authLimitCheck.allowed) {
    return { success: false, message: authLimitCheck.message };
  }

  const reqCheck = checkRequestRateLimit();
  if (!reqCheck.allowed) {
    return { success: false, message: reqCheck.message };
  }

  const supabase = getSupabase();
  if (!supabase) throw new Error('Database service is not configured.');

  let salt = saltCache.get(cleanUser);
  if (!salt) {
    const { data: saltData, error: saltErr } = await supabase.rpc('todocli_get_salt', { p_username: cleanUser });
    if (saltErr) {
      if (saltErr.code === 'PGRST202' || saltErr.message?.includes('function') || saltErr.message?.includes('not found')) {
        return {
          success: false,
          message: 'Database setup required: Please run "supabase/schema.sql" in your Supabase SQL Editor to enable secure procedures and Row Level Security.'
        };
      }
      return { success: false, message: `Database error: ${saltErr.message}` };
    }
    if (saltData && saltData.length > 0 && saltData[0].salt) {
      salt = saltData[0].salt;
      saltCache.set(cleanUser, salt);
    }
  }

  if (!salt) {
    recordFailedAuth(cleanUser);
    return { success: false, message: 'Authentication failed: Invalid username or password.' };
  }

  const hash = await hashPassword(password, salt);
  const { data: authData, error: authErr } = await supabase.rpc('todocli_authenticate', {
    p_username: cleanUser,
    p_password_hash: hash
  });

  if (authErr) {
    if (authErr.code === 'PGRST202' || authErr.message?.includes('function') || authErr.message?.includes('not found')) {
      return {
        success: false,
        message: 'Database setup required: Please run "supabase/schema.sql" in your Supabase SQL Editor to enable secure procedures and Row Level Security.'
      };
    }
    return { success: false, message: `Database error: ${authErr.message}` };
  }

  if (authData && authData.success) {
    resetAuthRateLimit(cleanUser);
    return { success: true, user: { username: cleanUser, password_hash: hash, password_salt: salt } };
  } else {
    recordFailedAuth(cleanUser);
    const postLockout = checkAuthRateLimit(cleanUser);
    if (!postLockout.allowed) return { success: false, message: postLockout.message };
    return { success: false, message: authData?.message || 'Authentication failed: Invalid username or password.' };
  }
}

async function dbListTasks(username, password) {
  const auth = await dbAuthenticateUser(username, password);
  if (!auth.success) return { success: false, message: auth.message };

  const supabase = getSupabase();
  const cleanUser = username.trim();

  const { data, error } = await supabase.rpc('todocli_list_tasks', {
    p_username: cleanUser,
    p_password_hash: auth.user.password_hash
  });

  if (error) {
    if (error.code === 'PGRST202' || error.message?.includes('function') || error.message?.includes('not found')) {
      return {
        success: false,
        message: 'Database setup required: Please run "supabase/schema.sql" in your Supabase SQL Editor.'
      };
    }
    return { success: false, message: `Database error while listing tasks: ${error.message}` };
  }

  if (data && data.success) {
    const tasks = data.tasks || [];
    if (tasks.length === 0) return { success: true, message: `No tasks found for user '${cleanUser}'.`, tasks: [] };
    const formatted = tasks.map((t, idx) => `${idx + 1}. ${t.task_name}`).join('\n');
    return { success: true, message: formatted, tasks };
  }

  return { success: false, message: data?.message || 'Failed to list tasks.' };
}

async function dbAddTask(username, password, taskName) {
  const auth = await dbAuthenticateUser(username, password);
  if (!auth.success) return { success: false, message: auth.message };

  const supabase = getSupabase();
  const cleanUser = username.trim();

  const { data, error } = await supabase.rpc('todocli_add_task', {
    p_username: cleanUser,
    p_password_hash: auth.user.password_hash,
    p_task_name: taskName
  });

  if (error) {
    if (error.code === 'PGRST202' || error.message?.includes('function') || error.message?.includes('not found')) {
      return {
        success: false,
        message: 'Database setup required: Please run "supabase/schema.sql" in your Supabase SQL Editor.'
      };
    }
    return { success: false, message: `Database error while adding task: ${error.message}` };
  }

  return data || { success: true, message: `Task added: "${taskName}"` };
}

async function dbDeleteTask(username, password, taskNumberInput) {
  const auth = await dbAuthenticateUser(username, password);
  if (!auth.success) return { success: false, message: auth.message };

  let rawNumbers = [];
  if (Array.isArray(taskNumberInput)) {
    rawNumbers = taskNumberInput;
  } else if (typeof taskNumberInput === 'number') {
    rawNumbers = [taskNumberInput];
  } else if (typeof taskNumberInput === 'string') {
    const parts = taskNumberInput.trim().split(/[,\s]+/);
    for (const p of parts) {
      if (!p) continue;
      const parsed = parseInt(p, 10);
      if (isNaN(parsed) || parsed < 1) {
        return { success: false, message: `Error: Invalid task number '${p}'. Must be a positive integer.` };
      }
      rawNumbers.push(parsed);
    }
  }

  if (rawNumbers.length === 0) {
    return { success: false, message: 'Error: Missing task number. Usage: delete task <task_number>' };
  }

  const supabase = getSupabase();
  const cleanUser = username.trim();

  const { data, error } = await supabase.rpc('todocli_delete_tasks', {
    p_username: cleanUser,
    p_password_hash: auth.user.password_hash,
    p_task_numbers: rawNumbers
  });

  if (error) {
    if (error.code === 'PGRST202' || error.message?.includes('function') || error.message?.includes('not found')) {
      return {
        success: false,
        message: 'Database setup required: Please run "supabase/schema.sql" in your Supabase SQL Editor.'
      };
    }
    return { success: false, message: `Database error while deleting task: ${error.message}` };
  }

  return data;
}

async function dbPriorityTask(username, password, fromNumber, toNumber) {
  const auth = await dbAuthenticateUser(username, password);
  if (!auth.success) return { success: false, message: auth.message };

  const supabase = getSupabase();
  const cleanUser = username.trim();

  const { data, error } = await supabase.rpc('todocli_priority_task', {
    p_username: cleanUser,
    p_password_hash: auth.user.password_hash,
    p_from: fromNumber,
    p_to: toNumber
  });

  if (error) {
    if (error.code === 'PGRST202' || error.message?.includes('function') || error.message?.includes('not found')) {
      return {
        success: false,
        message: 'Database setup required: Please run "supabase/schema.sql" in your Supabase SQL Editor.'
      };
    }
    return { success: false, message: `Database error while reordering task: ${error.message}` };
  }

  return data;
}

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
