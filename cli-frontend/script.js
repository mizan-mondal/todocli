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
const terminalHistory = document.getElementById('terminal-history');

document.addEventListener('DOMContentLoaded', () => {
  updatePrompt();
  showWelcomeNotice();

  if (cliInput) {
    cliInput.focus();
    cliInput.addEventListener('keydown', handleKeydown);
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

function showWelcomeNotice() {
  if (!isSupabaseConfigured()) {
    appendSystemNotice(
      '⚠️  Supabase is not configured yet.\n' +
      'To access your tasks from anywhere, configure your project:\n' +
      'Run: config supabase <SUPABASE_URL> <SUPABASE_ANON_KEY>\n' +
      'Type \'help\' for all available commands.'
    );
  } else {
    const config = getSupabaseConfig();
    try {
      const hostname = new URL(config.url).hostname;
      appendSystemNotice(`⚡ Connected to Supabase Database (${hostname})`);
    } catch (e) {
      appendSystemNotice('⚡ Connected to Supabase Cloud Database');
    }
  }
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
    ? ['help', 'clear', 'cls', 'list', 'add task ', 'delete task ', 'logout', 'whoami', 'config supabase ']
    : ['help', 'clear', 'cls', 'create', 'login', 'logout', 'list', 'add task ', 'delete task ', 'config supabase '];

  const match = available.find(c => c.startsWith(val));
  if (match) {
    cliInput.value = match;
  }
}

function getHelpText() {
  return [
    'todocli Commands (Cloud-Synced via Supabase):',
    '  <username> <password> create                   - Register a new account in Supabase',
    '  <username> <password> login                    - Log in & store session offline in browser',
    '  <username> <password> logout                   - Log out & clear browser session',
    '  <username> <password> list                     - List all tasks from Supabase',
    '  <username> <password> add task <task_name>     - Add task to Supabase',
    '  <username> <password> delete task <task_number>- Delete task from Supabase',
    '',
    'When Logged In (Shortcut Commands):',
    '  list                                           - List your tasks',
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
    commandToRun = `${session.username} ${session.password} ${raw}`;
  }

  if (!isSupabaseConfigured()) {
    appendHistory(
      raw,
      'Error: Supabase is not configured.\n' +
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

  if (parts.length === 2 || (parts.length === 3 && parts[2].toLowerCase() === 'status')) {
    const config = getSupabaseConfig();
    if (config.url && config.key) {
      const maskedKey = config.key.length > 12 
        ? `${config.key.substring(0, 8)}...${config.key.substring(config.key.length - 4)}` 
        : '***';
      appendHistory(
        raw,
        `Supabase Configuration:\n  Status: Connected\n  URL: ${config.url}\n  Anon Key: ${maskedKey}`,
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

  if (parts.length === 3 && parts[2].toLowerCase() === 'clear') {
    clearSupabaseConfig();
    appendHistory(raw, 'Browser-stored Supabase credentials cleared.', 'success', activePrompt);
    return;
  }

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

  const supabase = getSupabase();
  if (!supabase) {
    appendHistory(displayCmd, 'Error: Supabase client could not be initialized.', 'error', activePrompt);
    return;
  }

  try {
    if (operation === 'create') {
      const { data: existing, error: checkError } = await supabase
        .from('users')
        .select('username')
        .eq('username', username)
        .maybeSingle();

      if (checkError) {
        appendHistory(displayCmd, `Database Error: ${checkError.message}`, 'error', activePrompt);
        return;
      }

      if (existing) {
        appendHistory(displayCmd, `Error: User '${username}' already exists.`, 'error', activePrompt);
        return;
      }

      const salt = generateHexSalt();
      const hash = await hashPassword(password, salt);

      const { error: insertError } = await supabase
        .from('users')
        .insert([{ username, password_hash: hash, password_salt: salt }]);

      if (insertError) {
        appendHistory(displayCmd, `Database Error: ${insertError.message}`, 'error', activePrompt);
        return;
      }

      appendHistory(displayCmd, `User '${username}' created successfully in Supabase.`, 'success', activePrompt);
      return;
    }

    // Authenticate user credentials
    const { data: user, error: authError } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .maybeSingle();

    if (authError) {
      appendHistory(displayCmd, `Database Error: ${authError.message}`, 'error', activePrompt);
      return;
    }

    if (!user) {
      appendHistory(displayCmd, 'Authentication failed: Invalid username or password.', 'error', activePrompt);
      return;
    }

    const computedHash = await hashPassword(password, user.password_salt);
    if (computedHash !== user.password_hash) {
      appendHistory(displayCmd, 'Authentication failed: Invalid username or password.', 'error', activePrompt);
      return;
    }

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
        const { data: tasks, error: listError } = await supabase
          .from('tasks')
          .select('id, task_name')
          .eq('username', username)
          .order('id', { ascending: true });

        if (listError) {
          appendHistory(displayCmd, `Database Error: ${listError.message}`, 'error', activePrompt);
          return;
        }

        if (!tasks || tasks.length === 0) {
          appendHistory(displayCmd, `No tasks found for user '${username}'.`, '', activePrompt);
          return;
        }

        const lines = tasks.map((t, idx) => `${idx + 1}. ${t.task_name}`);
        appendHistory(displayCmd, lines.join('\n'), '', activePrompt);
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

        const { error: addError } = await supabase
          .from('tasks')
          .insert([{ username, task_name: taskName }]);

        if (addError) {
          appendHistory(displayCmd, `Database Error: ${addError.message}`, 'error', activePrompt);
          return;
        }

        appendHistory(displayCmd, `Task added: "${taskName}"`, 'success', activePrompt);
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

        const { data: tasks, error: fetchError } = await supabase
          .from('tasks')
          .select('id, task_name')
          .eq('username', username)
          .order('id', { ascending: true });

        if (fetchError) {
          appendHistory(displayCmd, `Database Error: ${fetchError.message}`, 'error', activePrompt);
          return;
        }

        if (!tasks || taskNumber > tasks.length) {
          appendHistory(displayCmd, `Error: Task #${taskNumber} not found. Use 'list' to view current tasks.`, 'error', activePrompt);
          return;
        }

        const targetTask = tasks[taskNumber - 1];
        const { error: delError } = await supabase
          .from('tasks')
          .delete()
          .eq('id', targetTask.id);

        if (delError) {
          appendHistory(displayCmd, `Database Error: ${delError.message}`, 'error', activePrompt);
          return;
        }

        appendHistory(displayCmd, `Task #${taskNumber} deleted: "${targetTask.task_name}"`, 'success', activePrompt);
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
  } catch (err) {
    appendHistory(displayCmd, `Database Error: ${err.message}`, 'error', activePrompt);
  }
}

function appendSystemNotice(message) {
  const entry = document.createElement('div');
  entry.className = 'history-entry system-notice';
  entry.innerHTML = `<div class="history-output" style="color: #94a3b8; font-size: 13.5px; border-left: 2px solid #3b82f6; padding-left: 8px; margin-bottom: 12px;">${escapeHtml(message)}</div>`;
  terminalHistory.appendChild(entry);
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
