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
let pendingPrompt = null;

// DOM Elements
const cliInput = document.getElementById('cli-input');
const cliInputDisplay = document.getElementById('cli-input-display');
const terminalHistory = document.getElementById('terminal-history');

const NON_CREDENTIAL_COMMANDS = new Set([
  'help', 'clear', 'cls', 'whoami', 'list', 'ls', 'add', 'delete', 'priority', 'deadline', 'logout'
]);

// =============================================================================
// Client-Side Natural Language Processing (NLP) & Date Parsing Utility
// Runs 100% locally on user device using client compute.
// =============================================================================

const NLP_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const NLP_SHORT_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const NLP_MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];
const NLP_SHORT_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function getOrdinalSuffix(day) {
  if (day >= 11 && day <= 13) return `${day}th`;
  switch (day % 10) {
    case 1: return `${day}st`;
    case 2: return `${day}nd`;
    case 3: return `${day}rd`;
    default: return `${day}th`;
  }
}

function formatDateNice(date) {
  if (!date || isNaN(date.getTime())) return '';
  const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
  const dayNum = date.getDate();
  const monthName = date.toLocaleDateString('en-US', { month: 'long' });
  const year = date.getFullYear();
  return `${dayName}, ${getOrdinalSuffix(dayNum)} ${monthName} ${year}`;
}

function formatDeadlineBadge(deadlineDate) {
  if (!deadlineDate) return '';
  const date = deadlineDate instanceof Date ? deadlineDate : new Date(deadlineDate);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const tomorrowEnd = new Date(todayEnd.getTime() + 24 * 3600 * 1000);

  const dayStr = date.toLocaleDateString('en-US', { weekday: 'short' });
  const monthStr = date.toLocaleDateString('en-US', { month: 'short' });
  const dateNum = date.getDate();
  const year = date.getFullYear();

  if (date < todayStart) {
    return `[OVERDUE: ${dateNum} ${monthStr} ${year}]`;
  } else if (date <= todayEnd) {
    return '[DUE TODAY]';
  } else if (date <= tomorrowEnd) {
    return '[DUE TOMORROW]';
  } else {
    return `[Due: ${dayStr}, ${dateNum} ${monthStr} ${year}]`;
  }
}

function getTaskUrgency(deadlineDate) {
  if (!deadlineDate) return 'none';
  const date = deadlineDate instanceof Date ? deadlineDate : new Date(deadlineDate);
  if (isNaN(date.getTime())) return 'none';

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  if (date < todayStart) {
    return 'overdue';
  }

  const msDiff = date.getTime() - now.getTime();
  if (msDiff <= 48 * 3600 * 1000) {
    return 'due-soon';
  }

  return 'upcoming';
}

function parseManualDate(input) {
  if (!input) return null;
  const raw = input.trim().toLowerCase();
  if (raw === 'n' || raw === 'no' || raw === 'none' || raw === 'cancel') {
    return null;
  }

  if (/^\d{6}$/.test(raw)) {
    const day = parseInt(raw.slice(0, 2), 10);
    const month = parseInt(raw.slice(2, 4), 10);
    const year = 2000 + parseInt(raw.slice(4, 6), 10);
    return createValidDate(year, month, day);
  }

  if (/^\d{8}$/.test(raw)) {
    const day = parseInt(raw.slice(0, 2), 10);
    const month = parseInt(raw.slice(2, 4), 10);
    const year = parseInt(raw.slice(4, 8), 10);
    return createValidDate(year, month, day);
  }

  const matchDelim = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (matchDelim) {
    const day = parseInt(matchDelim[1], 10);
    const month = parseInt(matchDelim[2], 10);
    let year = parseInt(matchDelim[3], 10);
    if (year < 100) year += 2000;
    return createValidDate(year, month, day);
  }

  const matchIso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (matchIso) {
    const year = parseInt(matchIso[1], 10);
    const month = parseInt(matchIso[2], 10);
    const day = parseInt(matchIso[3], 10);
    return createValidDate(year, month, day);
  }

  const natural = parseNaturalDeadline(`dummy by ${raw}`);
  if (natural && natural.hasNlpCue && natural.dateObj) {
    return natural.dateObj;
  }

  return null;
}

function createValidDate(year, month, day) {
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day, 23, 59, 59, 999);
  if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) {
    return d;
  }
  return null;
}

function extractExplicitDeadlineFlag(rawText) {
  const flagRegex = /\s+--by\s+(\S+)\s*$/i;
  const match = rawText.match(flagRegex);
  if (!match) return null;

  const flagValue = match[1].trim();
  const cleanedText = rawText.replace(flagRegex, '').trim();

  if (flagValue.toLowerCase() === 'n' || flagValue.toLowerCase() === 'none') {
    return {
      isExplicit: true,
      hasDeadline: false,
      deadlineDate: null,
      cleanedText,
      displayMsg: 'No deadline set (flag --by n).'
    };
  }

  const parsedDate = parseManualDate(flagValue);
  if (!parsedDate) {
    return {
      isExplicit: true,
      error: `Invalid date '${flagValue}' in --by flag. Use DDMMYY format (e.g. 281026) or "n" for no deadline.`
    };
  }

  return {
    isExplicit: true,
    hasDeadline: true,
    deadlineDate: parsedDate,
    cleanedText,
    formatted: formatDateNice(parsedDate)
  };
}

function parseNaturalDeadline(taskText) {
  if (!taskText) {
    return { hasNlpCue: false, cleanedTaskName: '', deadline: null };
  }

  const text = taskText.trim();
  const now = new Date();
  const currentDay = now.getDay();

  // 1. Check with trigger preposition: by, before, on, due, until
  // e.g. "by friday", "on this saturday", "by next wednesday", "by 29 oct", "due tomorrow"
  const triggerRegex = /(?:^|\s+)(?:by|before|on|due\s+on|due|until)\s+(.+)$/i;
  const triggerMatch = text.match(triggerRegex);

  let candidatePhrase = '';
  let matchIndex = -1;

  if (triggerMatch) {
    candidatePhrase = triggerMatch[1].trim().toLowerCase();
    matchIndex = triggerMatch.index;
  } else {
    // 2. Check without preposition if ending with known date expressions:
    // e.g. "next wednesday", "this saturday", "tomorrow", "today", "29 oct", "in 3 days"
    const directPatterns = [
      /(?:^|\s+)((?:this|next)\s+[a-z]+)$/i,
      /(?:^|\s+)(tomorrow|today|tonight)$/i,
      /(?:^|\s+)(in\s+\d+\s+(?:day|days|week|weeks))$/i,
      /(?:^|\s+)(\d{1,2}(?:st|nd|rd|th)?\s+[a-z]+)$/i,
      /(?:^|\s+)([a-z]+\s+\d{1,2}(?:st|nd|rd|th)?)$/i,
      /(?:^|\s+)(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|tues|thur|thurs)$/i
    ];

    for (const pattern of directPatterns) {
      const match = text.match(pattern);
      if (match) {
        candidatePhrase = match[1].trim().toLowerCase();
        matchIndex = match.index;
        break;
      }
    }
  }

  if (!candidatePhrase) {
    return { hasNlpCue: false, cleanedTaskName: text, deadline: null };
  }

  let targetDate = null;

  if (candidatePhrase === 'today' || candidatePhrase === 'tonight') {
    targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  } else if (candidatePhrase === 'tomorrow') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    targetDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  } else if (/^this\s+([a-z]+)$/i.test(candidatePhrase)) {
    const dayWord = candidatePhrase.match(/^this\s+([a-z]+)$/i)[1];
    const targetIdx = getNlpWeekdayIndex(dayWord);
    if (targetIdx !== -1) {
      const diff = (targetIdx - currentDay + 7) % 7;
      const d = new Date(now);
      d.setDate(d.getDate() + diff);
      targetDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    }
  } else if (/^next\s+([a-z]+)$/i.test(candidatePhrase)) {
    const dayWord = candidatePhrase.match(/^next\s+([a-z]+)$/i)[1];
    const targetIdx = getNlpWeekdayIndex(dayWord);
    if (targetIdx !== -1) {
      let diff = (targetIdx - currentDay + 7) % 7;
      diff += 7;
      const d = new Date(now);
      d.setDate(d.getDate() + diff);
      targetDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    }
  } else if (getNlpWeekdayIndex(candidatePhrase) !== -1) {
    const targetIdx = getNlpWeekdayIndex(candidatePhrase);
    let diff = (targetIdx - currentDay + 7) % 7;
    const d = new Date(now);
    d.setDate(d.getDate() + diff);
    targetDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  } else {
    const dateMatch = parseNlpDayMonthExpression(candidatePhrase);
    if (dateMatch) targetDate = dateMatch;
  }

  if (!targetDate) {
    const inMatch = candidatePhrase.match(/^in\s+(\d+)\s+(day|days|week|weeks)$/i);
    if (inMatch) {
      const num = parseInt(inMatch[1], 10);
      const unit = inMatch[2].toLowerCase();
      const addDays = unit.startsWith('week') ? num * 7 : num;
      const d = new Date(now);
      d.setDate(d.getDate() + addDays);
      targetDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    }
  }

  if (!targetDate) {
    return { hasNlpCue: false, cleanedTaskName: text, deadline: null };
  }

  const cleanedTaskName = text.slice(0, matchIndex).trim();

  return {
    hasNlpCue: true,
    cleanedTaskName: cleanedTaskName || text,
    dateObj: targetDate,
    deadline: targetDate.toISOString(),
    formattedDisplay: formatDateNice(targetDate)
  };
}

function getNlpWeekdayIndex(word) {
  const clean = word.toLowerCase();
  const full = NLP_DAYS.indexOf(clean);
  if (full !== -1) return full;
  const short = NLP_SHORT_DAYS.indexOf(clean.slice(0, 3));
  if (short !== -1) return short;
  if (clean === 'tues') return 2;
  if (clean === 'thur' || clean === 'thurs') return 4;
  return -1;
}

function parseNlpDayMonthExpression(phrase) {
  const now = new Date();
  const currentYear = now.getFullYear();

  const m1 = phrase.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)$/i);
  if (m1) {
    const day = parseInt(m1[1], 10);
    const monthIdx = getNlpMonthIndex(m1[2]);
    if (monthIdx !== -1) return buildNlpDateWithRollover(currentYear, monthIdx, day);
  }

  const m2 = phrase.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?$/i);
  if (m2) {
    const monthIdx = getNlpMonthIndex(m2[1]);
    const day = parseInt(m2[2], 10);
    if (monthIdx !== -1) return buildNlpDateWithRollover(currentYear, monthIdx, day);
  }

  return null;
}

function getNlpMonthIndex(word) {
  const clean = word.toLowerCase();
  const full = NLP_MONTHS.indexOf(clean);
  if (full !== -1) return full;
  const short = NLP_SHORT_MONTHS.indexOf(clean.slice(0, 3));
  if (short !== -1) return short;
  return -1;
}

function buildNlpDateWithRollover(currentYear, monthIdx, day) {
  const now = new Date();
  let year = currentYear;
  let testDate = new Date(year, monthIdx, day, 23, 59, 59, 999);
  if (testDate < now) {
    year += 1;
    testDate = new Date(year, monthIdx, day, 23, 59, 59, 999);
  }
  if (testDate.getMonth() === monthIdx && testDate.getDate() === day) {
    return testDate;
  }
  return null;
}

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
    ? ['help', 'clear', 'cls', 'list', 'ls', 'add task ', 'delete task ', 'priority ', 'deadline ', 'logout', 'whoami']
    : ['help', 'clear', 'cls', 'create', 'login', 'logout', 'list', 'ls', 'add task ', 'delete task ', 'priority ', 'deadline '];

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
    '  <username> <password> list / ls                - List all tasks with color-coded deadlines',
    '  <username> <password> add task <task_name>     - Add a new task (auto-detects NLP deadline)',
    '  <username> <password> add task <name> --by <d> - Add task with explicit deadline (DDMMYY or n)',
    '  <username> <password> delete task <numbers>    - Delete tasks by number (e.g. 1 or 1,2,5)',
    '  <username> <password> priority <from> to <to>  - Reorder task by moving to a new position',
    '  <username> <password> deadline <num> <date>    - Set/change deadline (DDMMYY, weekday, or none)',
    '',
    'When Logged In (Shortcut Commands):',
    '  list / ls                                      - List your tasks',
    '  add task <task_name>                           - Add a new task (auto-detects NLP deadline)',
    '  add task <name> --by <DDMMYY|n>                - Add task with explicit deadline (no prompt)',
    '  delete task <task_numbers>                     - Delete tasks by number (e.g. 1 or 1,2,5)',
    '  priority <from> to <to>                        - Move task to new priority position',
    '  deadline <task_number> <date|none>             - Set/change/remove task deadline',
    '  whoami                                         - Show active logged-in user',
    '  logout                                         - Log out active session',
    '',
    'Deadline Urgency Colors (applied directly to task names):',
    '  Red    - Overdue',
    '  Yellow - Due today / within 48 hours',
    '  Green  - Upcoming (> 48 hours away)',
    '  Gray   - No deadline',
    '',
    'Utilities:',
    '  clear / cls                                    - Clear terminal screen',
    '  help                                           - Display this manual'
  ].join('\n');
}

/**
 * Handles interactive NLP confirmation & manual deadline input state machine
 */
async function handlePendingPrompt(raw) {
  if (!pendingPrompt) return;

  const input = raw.trim().toLowerCase();
  const { username, password, taskName, candidateDeadline, formattedDisplay, activePrompt } = pendingPrompt;

  if (pendingPrompt.step === 'CONFIRM_NLP') {
    if (input === 'y' || input === 'yes') {
      appendHistory(raw, '', '', activePrompt);
      const result = await dbAddTask(username, password, taskName, candidateDeadline);
      pendingPrompt = null;
      appendHistory('', result.success ? `Task added: "${taskName}" [Deadline: ${formattedDisplay}]` : result.message, result.success ? 'success' : 'error', activePrompt);
    } else if (input === 'n' || input === 'no') {
      appendHistory(raw, '', '', activePrompt);
      pendingPrompt.step = 'MANUAL_DATE';
      appendHistory('', 'Please enter deadline in "DDMMYY" format (or press Enter for no deadline):', 'prompt-query', activePrompt);
    } else if (input === 'cancel') {
      appendHistory(raw, 'Task creation cancelled.', '', activePrompt);
      pendingPrompt = null;
    } else {
      appendHistory(raw, 'Please enter "y" to confirm, "n" to enter another deadline, or "cancel" to abort:', 'prompt-query', activePrompt);
    }
    return;
  }

  if (pendingPrompt.step === 'MANUAL_DATE') {
    if (!input || input === 'n' || input === 'no' || input === 'none') {
      appendHistory(raw || 'n', '', '', activePrompt);
      const result = await dbAddTask(username, password, taskName, null);
      pendingPrompt = null;
      appendHistory('', result.success ? `Task added: "${taskName}" (no deadline)` : result.message, result.success ? 'success' : 'error', activePrompt);
    } else if (input === 'cancel') {
      appendHistory(raw, 'Task creation cancelled.', '', activePrompt);
      pendingPrompt = null;
    } else {
      const parsedDate = parseManualDate(input);
      if (parsedDate) {
        appendHistory(raw, '', '', activePrompt);
        const iso = parsedDate.toISOString();
        const nice = formatDateNice(parsedDate);
        const result = await dbAddTask(username, password, taskName, iso);
        pendingPrompt = null;
        appendHistory('', result.success ? `Task added: "${taskName}" [Deadline: ${nice}]` : result.message, result.success ? 'success' : 'error', activePrompt);
      } else {
        appendHistory(raw, `Error: Invalid date format '${raw}'.\nPlease enter deadline in "DDMMYY" format (e.g. 281026) or press Enter for no deadline:`, 'error', activePrompt);
      }
    }
    return;
  }
}

async function executeCommand() {
  const raw = cliInput.value.trim();
  if (!raw) return;

  // Intercept interactive prompt states (e.g., NLP confirmation or manual date input)
  if (pendingPrompt) {
    commandHistory.push(raw);
    if (commandHistory.length > 100) commandHistory.shift();
    localStorage.setItem('todocli_history', JSON.stringify(commandHistory));
    historyIndex = -1;
    cliInput.value = '';
    updateInputDisplay();
    await handlePendingPrompt(raw);
    return;
  }

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
  const isShortcut = ['list', 'ls', 'add', 'delete', 'priority', 'deadline', 'logout'].includes(firstTokenLower);

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

async function dbAddTask(username, password, taskName, deadline = null) {
  const auth = await dbAuthenticateUser(username, password);
  if (!auth.success) return { success: false, message: auth.message };

  const supabase = getSupabase();
  const cleanUser = username.trim();

  const { data, error } = await supabase.rpc('todocli_add_task', {
    p_username: cleanUser,
    p_password_hash: auth.user.password_hash,
    p_task_name: taskName,
    p_deadline: deadline
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

async function dbUpdateDeadline(username, password, taskNumber, deadline = null) {
  const auth = await dbAuthenticateUser(username, password);
  if (!auth.success) return { success: false, message: auth.message };

  const supabase = getSupabase();
  const cleanUser = username.trim();

  const { data, error } = await supabase.rpc('todocli_update_deadline', {
    p_username: cleanUser,
    p_password_hash: auth.user.password_hash,
    p_task_number: parseInt(taskNumber, 10),
    p_deadline: deadline
  });

  if (error) {
    if (error.code === 'PGRST202' || error.message?.includes('function') || error.message?.includes('not found')) {
      return {
        success: false,
        message: 'Database setup required: Please run "supabase/schema.sql" in your Supabase SQL Editor.'
      };
    }
    return { success: false, message: `Database error while updating deadline: ${error.message}` };
  }

  return data || { success: true, message: `Deadline updated for task #${taskNumber}.` };
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
        if (!result.success) {
          appendHistory(displayCmd, result.message, 'error', activePrompt);
          break;
        }

        const tasks = result.tasks || [];
        if (tasks.length === 0) {
          appendHistory(displayCmd, `No tasks found for user '${username}'.`, '', activePrompt);
          break;
        }

        const lines = tasks.map((t, idx) => {
          const urgency = getTaskUrgency(t.deadline);
          const badge = t.deadline ? formatDeadlineBadge(t.deadline) : '';
          const badgeHtml = badge ? ` <span class="task-deadline-badge task-${urgency}">${escapeHtml(badge)}</span>` : '';
          return `<div class="task-line task-${urgency}"><span class="task-num">${idx + 1}.</span><span class="task-title">${escapeHtml(t.task_name)}</span>${badgeHtml}</div>`;
        }).join('');

        appendHistory(displayCmd, lines, '', activePrompt, true);
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
        const rawTaskInput = remainderTokens.slice(1).join(' ').trim();
        if (!rawTaskInput) {
          appendHistory(displayCmd, 'Error: Task description cannot be empty. Usage: add task <task_name>', 'error', activePrompt);
          return;
        }

        // 1. Check for explicit --by flag (bypasses interactive prompting)
        const explicit = extractExplicitDeadlineFlag(rawTaskInput);
        if (explicit) {
          if (explicit.error) {
            appendHistory(displayCmd, `Error: ${explicit.error}`, 'error', activePrompt);
            return;
          }

          if (!explicit.hasDeadline) {
            // Explicitly no deadline (--by n)
            const result = await dbAddTask(username, password, explicit.cleanedText, null);
            appendHistory(displayCmd, result.success ? `Task added: "${explicit.cleanedText}" (no deadline)` : result.message, result.success ? 'success' : 'error', activePrompt);
            return;
          }

          // Explicit deadline set
          const iso = explicit.deadlineDate.toISOString();
          const result = await dbAddTask(username, password, explicit.cleanedText, iso);
          appendHistory(displayCmd, result.success ? `Task added: "${explicit.cleanedText}" [Deadline: ${explicit.formatted}]` : result.message, result.success ? 'success' : 'error', activePrompt);
          return;
        }

        // 2. Client-side NLP extraction
        const nlp = parseNaturalDeadline(rawTaskInput);
        if (nlp.hasNlpCue) {
          pendingPrompt = {
            step: 'CONFIRM_NLP',
            username,
            password,
            taskName: nlp.cleanedTaskName,
            candidateDeadline: nlp.deadline,
            formattedDisplay: nlp.formattedDisplay,
            displayCmd,
            activePrompt
          };

          appendHistory(
            displayCmd,
            `[NLP] Detected deadline: ${nlp.formattedDisplay}\nConfirm deadline? (y/n):`,
            'prompt-query',
            activePrompt
          );
          return;
        }

        // 3. No date cues detected: create task immediately with no deadline (single step)
        const result = await dbAddTask(username, password, rawTaskInput, null);
        appendHistory(displayCmd, result.message, result.success ? 'success' : 'error', activePrompt);
        break;
      }

      case 'deadline': {
        if (remainderTokens.length === 0) {
          appendHistory(displayCmd, 'Error: Missing arguments. Usage: deadline <task_number> <date|none>\nExample: deadline 2 281026 or deadline 2 friday', 'error', activePrompt);
          return;
        }

        const taskNum = remainderTokens[0];
        const dateArg = remainderTokens.slice(1).join(' ').trim();

        if (!dateArg) {
          appendHistory(displayCmd, 'Error: Missing deadline date. Usage: deadline <task_number> <date|none>\nExample: deadline 2 281026 or deadline 2 friday or deadline 2 none', 'error', activePrompt);
          return;
        }

        const dateArgLower = dateArg.toLowerCase();
        if (dateArgLower === 'none' || dateArgLower === 'clear' || dateArgLower === 'remove' || dateArgLower === 'n') {
          const result = await dbUpdateDeadline(username, password, taskNum, null);
          appendHistory(displayCmd, result.message, result.success ? 'success' : 'error', activePrompt);
          return;
        }

        let parsedDate = parseManualDate(dateArg);
        if (!parsedDate) {
          const natural = parseNaturalDeadline(`dummy by ${dateArg}`);
          if (natural.hasNlpCue && natural.dateObj) {
            parsedDate = natural.dateObj;
          }
        }

        if (!parsedDate) {
          appendHistory(displayCmd, `Error: Could not parse date '${dateArg}'. Use DDMMYY format (e.g. 281026), a weekday, or 'none'.`, 'error', activePrompt);
          return;
        }

        const result = await dbUpdateDeadline(username, password, taskNum, parsedDate.toISOString());
        appendHistory(displayCmd, result.success ? `${result.message} [Deadline: ${formatDateNice(parsedDate)}]` : result.message, result.success ? 'success' : 'error', activePrompt);
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
          `Error: Unknown operation '${operation}'. Allowed operations: create, login, logout, list, ls, add task, delete task, priority, deadline. Type 'help' for usage.`,
          'error',
          activePrompt
        );
        break;
    }
  } catch (err) {
    appendHistory(displayCmd, `Database Error: ${err.message}`, 'error', activePrompt);
  }
}

function appendHistory(cmd, output, type = '', promptLabel = null, isHtml = false) {
  const entry = document.createElement('div');
  entry.className = 'history-entry';

  const session = getSession();
  const label = promptLabel || (session && session.username ? `${session.username}:~$` : 'todocli:~$');

  const maskedCmd = maskCommand(cmd);
  const content = isHtml ? output : escapeHtml(output);

  entry.innerHTML = `
    <div class="history-command">
      <span class="history-prompt">${escapeHtml(label)}</span>
      <span class="history-cmd-text">${escapeHtml(maskedCmd)}</span>
    </div>
    ${output ? `<div class="history-output ${type}">${content}</div>` : ''}
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
