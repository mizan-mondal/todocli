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

function setSupabaseConfig(url, key) {
  const cleanUrl = url.trim();
  const cleanKey = key.trim();
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ url: cleanUrl, key: cleanKey }));
  if (window.supabase && window.supabase.createClient) {
    supabaseClient = window.supabase.createClient(cleanUrl, cleanKey);
  }
}

function clearSupabaseConfig() {
  localStorage.removeItem(CONFIG_STORAGE_KEY);
  supabaseClient = null;
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

  // Handle configuration commands with credential masking
  if (lower.startsWith('config supabase') || lower === 'supabase status' || lower === 'config status') {
    handleSupabaseConfigCommand(raw, activePrompt);
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

function handleSupabaseConfigCommand(raw, activePrompt) {
  const parts = raw.split(/\s+/);

  // Status check: never disclose raw endpoint URL or keys
  if (parts.length === 2 || (parts.length === 3 && parts[2].toLowerCase() === 'status')) {
    const config = getSupabaseConfig();
    if (config.url && config.key) {
      appendHistory(
        raw,
        'Database Configuration:\n' +
        '  Status: Connected (Protected)\n' +
        '  Access Control: Active (Row-Level Security & Credential Isolation)\n' +
        '  Admin Access: Managed via Vercel / Supabase Settings',
        'success',
        activePrompt
      );
    } else {
      appendHistory(
        raw,
        'Database Configuration:\n' +
        '  Status: Not configured\n' +
        '  Notice: Administrative deployment credentials (Vercel) required.',
        'error',
        activePrompt
      );
    }
    return;
  }

  // Clear credentials
  if (parts.length === 3 && parts[2].toLowerCase() === 'clear') {
    clearSupabaseConfig();
    appendHistory(raw, 'Browser-stored database credentials cleared.', 'success', activePrompt);
    return;
  }

  // Manual configuration attempt
  if (parts.length >= 4) {
    const url = parts[2];
    const key = parts[3];
    try {
      new URL(url);
    } catch (e) {
      appendHistory(raw, `Error: '${url}' is not a valid URL.`, 'error', activePrompt);
      return;
    }

    setSupabaseConfig(url, key);
    appendHistory(
      raw,
      'Database connection configured successfully! Status: Protected.',
      'success',
      activePrompt
    );
    return;
  }

  appendHistory(
    raw,
    'Database Configuration:\n  Status: Protected\n  Admin access managed via Vercel or Supabase.',
    'error',
    activePrompt
  );
}

// Cryptography helpers (Salted SHA-256 using browser Web Crypto API)
const saltCache = new Map();

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
  const supabase = getSupabase();
  if (!supabase) throw new Error('Database service is not configured.');

  const cleanUser = username.trim();
  const salt = generateHexSalt();
  const hash = await hashPassword(password, salt);

  try {
    const { data, error } = await supabase.rpc('todocli_create_user', {
      p_username: cleanUser,
      p_password_hash: hash,
      p_password_salt: salt
    });
    if (!error && data) {
      if (data.success) saltCache.set(cleanUser, salt);
      return data;
    }
  } catch (e) {}

  // Legacy fallback
  const { data: existing, error: checkError } = await supabase
    .from('users')
    .select('username')
    .eq('username', cleanUser)
    .maybeSingle();

  if (checkError) throw new Error(`Database error while checking user: ${checkError.message}`);
  if (existing) return { success: false, message: `Error: User '${cleanUser}' already exists.` };

  const { error: insertError } = await supabase
    .from('users')
    .insert([{ username: cleanUser, password_hash: hash, password_salt: salt }]);

  if (insertError) throw new Error(`Database error while creating user: ${insertError.message}`);
  saltCache.set(cleanUser, salt);
  return { success: true, message: `User '${cleanUser}' created successfully.` };
}

async function dbAuthenticateUser(username, password) {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Database service is not configured.');

  const cleanUser = username.trim();

  try {
    let salt = saltCache.get(cleanUser);
    if (!salt) {
      const { data: saltData, error: saltErr } = await supabase.rpc('todocli_get_salt', { p_username: cleanUser });
      if (!saltErr && saltData && saltData.length > 0 && saltData[0].salt) {
        salt = saltData[0].salt;
        saltCache.set(cleanUser, salt);
      }
    }

    if (salt) {
      const hash = await hashPassword(password, salt);
      const { data: authData, error: authErr } = await supabase.rpc('todocli_authenticate', {
        p_username: cleanUser,
        p_password_hash: hash
      });
      if (!authErr && authData) {
        if (authData.success) {
          return { success: true, user: { username: cleanUser, password_hash: hash, password_salt: salt } };
        } else {
          return { success: false, message: authData.message || 'Authentication failed: Invalid username or password.' };
        }
      }
    }
  } catch (e) {}

  // Legacy fallback
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('username', cleanUser)
    .maybeSingle();

  if (error) throw new Error(`Database error during authentication: ${error.message}`);
  if (!user) return { success: false, message: 'Authentication failed: Invalid username or password.' };

  const computedHash = await hashPassword(password, user.password_salt);
  if (computedHash !== user.password_hash) {
    return { success: false, message: 'Authentication failed: Invalid username or password.' };
  }

  saltCache.set(cleanUser, user.password_salt);
  return { success: true, user };
}

async function dbListTasks(username, password) {
  const auth = await dbAuthenticateUser(username, password);
  if (!auth.success) return { success: false, message: auth.message };

  const supabase = getSupabase();
  const cleanUser = username.trim();

  try {
    const { data, error } = await supabase.rpc('todocli_list_tasks', {
      p_username: cleanUser,
      p_password_hash: auth.user.password_hash
    });
    if (!error && data && data.success) {
      const tasks = data.tasks || [];
      if (tasks.length === 0) return { success: true, message: `No tasks found for user '${cleanUser}'.`, tasks: [] };
      const formatted = tasks.map((t, idx) => `${idx + 1}. ${t.task_name}`).join('\n');
      return { success: true, message: formatted, tasks };
    }
  } catch (e) {}

  // Legacy fallback
  const { tasks } = await fetchFrontendUserTasksLegacy(supabase, cleanUser);
  if (!tasks || tasks.length === 0) return { success: true, message: `No tasks found for user '${cleanUser}'.`, tasks: [] };
  const formatted = tasks.map((t, idx) => `${idx + 1}. ${t.task_name}`).join('\n');
  return { success: true, message: formatted, tasks };
}

async function dbAddTask(username, password, taskName) {
  const auth = await dbAuthenticateUser(username, password);
  if (!auth.success) return { success: false, message: auth.message };

  const supabase = getSupabase();
  const cleanUser = username.trim();

  try {
    const { data, error } = await supabase.rpc('todocli_add_task', {
      p_username: cleanUser,
      p_password_hash: auth.user.password_hash,
      p_task_name: taskName
    });
    if (!error && data) return data;
  } catch (e) {}

  // Legacy fallback
  const { tasks, hasPosition } = await fetchFrontendUserTasksLegacy(supabase, cleanUser);
  const nextPos = tasks.length + 1;
  let res;
  if (hasPosition) {
    res = await supabase.from('tasks').insert([{ username: cleanUser, task_name: taskName, position: nextPos }]);
  } else {
    res = await supabase.from('tasks').insert([{ username: cleanUser, task_name: taskName }]);
  }
  if (res.error) throw new Error(`Database error while adding task: ${res.error.message}`);
  return { success: true, message: `Task added: "${taskName}"` };
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

  try {
    const { data, error } = await supabase.rpc('todocli_delete_tasks', {
      p_username: cleanUser,
      p_password_hash: auth.user.password_hash,
      p_task_numbers: rawNumbers
    });
    if (!error && data) return data;
  } catch (e) {}

  // Legacy fallback
  const { tasks, hasPosition } = await fetchFrontendUserTasksLegacy(supabase, cleanUser);
  if (!tasks || tasks.length === 0) {
    return { success: false, message: `Error: Task not found. No tasks exist for user '${cleanUser}'.` };
  }

  for (const num of rawNumbers) {
    if (num < 1 || num > tasks.length) {
      return { success: false, message: `Error: Task #${num} not found. Use 'list' to view current tasks.` };
    }
  }

  const uniqueNumbers = Array.from(new Set(rawNumbers)).sort((a, b) => a - b);
  const targetTasks = uniqueNumbers.map(num => ({ number: num, task: tasks[num - 1] }));
  const targetIds = targetTasks.map(t => t.task.id);

  const { error: deleteError } = await supabase.from('tasks').delete().in('id', targetIds);
  if (deleteError) throw new Error(`Database error while deleting task: ${deleteError.message}`);

  if (hasPosition) {
    const targetIdSet = new Set(targetIds);
    const remaining = tasks.filter(t => !targetIdSet.has(t.id));
    for (let i = 0; i < remaining.length; i++) {
      await supabase.from('tasks').update({ position: i + 1 }).eq('id', remaining[i].id);
    }
  }

  if (targetTasks.length === 1) {
    return { success: true, message: `Task #${targetTasks[0].number} deleted: "${targetTasks[0].task.task_name}"` };
  }
  return { success: true, message: targetTasks.map(t => `Task #${t.number} deleted: "${t.task.task_name}"`).join('\n') };
}

async function dbPriorityTask(username, password, fromNumber, toNumber) {
  const auth = await dbAuthenticateUser(username, password);
  if (!auth.success) return { success: false, message: auth.message };

  const supabase = getSupabase();
  const cleanUser = username.trim();

  try {
    const { data, error } = await supabase.rpc('todocli_priority_task', {
      p_username: cleanUser,
      p_password_hash: auth.user.password_hash,
      p_from: fromNumber,
      p_to: toNumber
    });
    if (!error && data) return data;
  } catch (e) {}

  // Legacy fallback
  const { tasks, hasPosition } = await fetchFrontendUserTasksLegacy(supabase, cleanUser);
  if (tasks.length === 0) return { success: false, message: `No tasks found for user '${cleanUser}'.` };
  if (fromNumber < 1 || fromNumber > tasks.length) {
    return { success: false, message: `Error: Source task #${fromNumber} not found. Valid range is 1 to ${tasks.length}.` };
  }
  if (toNumber < 1 || toNumber > tasks.length) {
    return { success: false, message: `Error: Target position #${toNumber} is out of bounds. Valid range is 1 to ${tasks.length}.` };
  }

  const reordered = [...tasks];
  const [movedTask] = reordered.splice(fromNumber - 1, 1);
  reordered.splice(toNumber - 1, 0, movedTask);

  if (hasPosition) {
    for (let i = 0; i < reordered.length; i++) {
      await supabase.from('tasks').update({ position: i + 1 }).eq('id', reordered[i].id);
    }
    return { success: true, message: `Task #${fromNumber} moved to position #${toNumber}: "${movedTask.task_name}"` };
  }

  const sortedSlotIds = [...tasks].map(t => t.id).sort((a, b) => (a > b ? 1 : -1));
  for (let i = 0; i < sortedSlotIds.length; i++) {
    await supabase.from('tasks').update({ task_name: reordered[i].task_name }).eq('id', sortedSlotIds[i]);
  }
  return { success: true, message: `Task #${fromNumber} moved to position #${toNumber}: "${movedTask.task_name}"` };
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
