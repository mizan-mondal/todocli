import { createClient } from '@supabase/supabase-js';

const CONFIG_STORAGE_KEY = 'todocli_supabase_config';
let supabaseClient = null;

/**
 * Retrieve active Supabase credentials from environment or browser config
 */
export function getSupabaseConfig() {
  // 1. Check browser override first
  try {
    const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.url && parsed.key) {
        return { url: parsed.url.trim(), key: parsed.key.trim(), source: 'browser' };
      }
    }
  } catch (e) {}

  // 2. Check Vite environment variables
  const envUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
  const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

  if (envUrl && envKey && !envUrl.includes('your-project-id')) {
    return { url: envUrl, key: envKey, source: 'env' };
  }

  return { url: '', key: '', source: 'none' };
}

export function isSupabaseConfigured() {
  const config = getSupabaseConfig();
  return Boolean(config.url && config.key);
}

export function setSupabaseConfig(url, key) {
  const cleanUrl = url.trim();
  const cleanKey = key.trim();
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ url: cleanUrl, key: cleanKey }));
  supabaseClient = createClient(cleanUrl, cleanKey);
}

export function clearSupabaseConfig() {
  localStorage.removeItem(CONFIG_STORAGE_KEY);
  supabaseClient = null;
}

export function getSupabase() {
  if (supabaseClient) return supabaseClient;
  const config = getSupabaseConfig();
  if (config.url && config.key) {
    supabaseClient = createClient(config.url, config.key);
    return supabaseClient;
  }
  return null;
}

// =============================================================================
// Cryptographic Helpers (Salted SHA-256 via browser Web Crypto API)
// =============================================================================

export function generateHexSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password, hexSalt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + ':' + hexSalt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// =============================================================================
// Supabase Database Operations
// =============================================================================

export async function dbCreateUser(username, password) {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  // Check if username already exists in Supabase
  const { data: existing, error: checkError } = await supabase
    .from('users')
    .select('username')
    .eq('username', username)
    .maybeSingle();

  if (checkError) {
    throw new Error(`Database error while checking user: ${checkError.message}`);
  }

  if (existing) {
    return { success: false, message: `Error: User '${username}' already exists.` };
  }

  const salt = generateHexSalt();
  const hash = await hashPassword(password, salt);

  const { error: insertError } = await supabase
    .from('users')
    .insert([{ username, password_hash: hash, password_salt: salt }]);

  if (insertError) {
    throw new Error(`Database error while creating user: ${insertError.message}`);
  }

  return { success: true, message: `User '${username}' created successfully in Supabase.` };
}

export async function dbAuthenticateUser(username, password) {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('username', username)
    .maybeSingle();

  if (error) {
    throw new Error(`Database error during authentication: ${error.message}`);
  }

  if (!user) {
    return { success: false, message: 'Authentication failed: Invalid username or password.' };
  }

  const computedHash = await hashPassword(password, user.password_salt);
  if (computedHash !== user.password_hash) {
    return { success: false, message: 'Authentication failed: Invalid username or password.' };
  }

  return { success: true, user };
}

async function fetchUserTasks(supabase, username) {
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

export async function dbListTasks(username, password) {
  const auth = await dbAuthenticateUser(username, password);
  if (!auth.success) {
    return { success: false, message: auth.message };
  }

  const supabase = getSupabase();
  const { tasks } = await fetchUserTasks(supabase, username);

  if (!tasks || tasks.length === 0) {
    return { success: true, message: `No tasks found for user '${username}'.`, tasks: [] };
  }

  const formatted = tasks.map((t, idx) => `${idx + 1}. ${t.task_name}`).join('\n');
  return { success: true, message: formatted, tasks };
}

export async function dbAddTask(username, password, taskName) {
  const auth = await dbAuthenticateUser(username, password);
  if (!auth.success) {
    return { success: false, message: auth.message };
  }

  const supabase = getSupabase();
  const { tasks, hasPosition } = await fetchUserTasks(supabase, username);
  const nextPos = tasks.length + 1;

  let error = null;
  if (hasPosition) {
    const res = await supabase
      .from('tasks')
      .insert([{ username, task_name: taskName, position: nextPos }]);
    error = res.error;
  } else {
    const res = await supabase
      .from('tasks')
      .insert([{ username, task_name: taskName }]);
    error = res.error;
  }

  if (error && error.message && error.message.toLowerCase().includes('position')) {
    const fallback = await supabase
      .from('tasks')
      .insert([{ username, task_name: taskName }]);
    error = fallback.error;
  }

  if (error) {
    throw new Error(`Database error while adding task: ${error.message}`);
  }

  return { success: true, message: `Task added: "${taskName}"` };
}

export async function dbDeleteTask(username, password, taskNumber) {
  const auth = await dbAuthenticateUser(username, password);
  if (!auth.success) {
    return { success: false, message: auth.message };
  }

  const supabase = getSupabase();
  const { tasks, hasPosition } = await fetchUserTasks(supabase, username);

  if (!tasks || taskNumber < 1 || taskNumber > tasks.length) {
    return {
      success: false,
      message: `Error: Task #${taskNumber} not found. Use 'list' to view current tasks.`
    };
  }

  const targetTask = tasks[taskNumber - 1];

  const { error: deleteError } = await supabase
    .from('tasks')
    .delete()
    .eq('id', targetTask.id);

  if (deleteError) {
    throw new Error(`Database error while deleting task: ${deleteError.message}`);
  }

  // Re-sequence remaining tasks positions only if position column exists
  if (hasPosition) {
    const remaining = tasks.filter(t => t.id !== targetTask.id);
    for (let i = 0; i < remaining.length; i++) {
      await supabase
        .from('tasks')
        .update({ position: i + 1 })
        .eq('id', remaining[i].id);
    }
  }

  return { success: true, message: `Task #${taskNumber} deleted: "${targetTask.task_name}"` };
}

export async function dbPriorityTask(username, password, fromNumber, toNumber) {
  const auth = await dbAuthenticateUser(username, password);
  if (!auth.success) {
    return { success: false, message: auth.message };
  }

  const supabase = getSupabase();
  const { tasks, hasPosition } = await fetchUserTasks(supabase, username);

  if (tasks.length === 0) {
    return { success: false, message: `No tasks found for user '${username}'.` };
  }

  if (fromNumber < 1 || fromNumber > tasks.length) {
    return {
      success: false,
      message: `Error: Source task #${fromNumber} not found. Valid range is 1 to ${tasks.length}.`
    };
  }

  if (toNumber < 1 || toNumber > tasks.length) {
    return {
      success: false,
      message: `Error: Target position #${toNumber} is out of bounds. Valid range is 1 to ${tasks.length}.`
    };
  }

  // Move task from fromNumber to toNumber (1-based to 0-based)
  const reordered = [...tasks];
  const [movedTask] = reordered.splice(fromNumber - 1, 1);
  reordered.splice(toNumber - 1, 0, movedTask);

  if (hasPosition) {
    // Attempt updating 'position' column
    let positionUpdateSucceeded = true;
    for (let i = 0; i < reordered.length; i++) {
      const { error: updateErr } = await supabase
        .from('tasks')
        .update({ position: i + 1 })
        .eq('id', reordered[i].id);

      if (updateErr) {
        if (updateErr.message && updateErr.message.toLowerCase().includes('position')) {
          positionUpdateSucceeded = false;
          break;
        }
        throw new Error(`Database error while updating task priority: ${updateErr.message}`);
      }
    }

    if (positionUpdateSucceeded) {
      return {
        success: true,
        message: `Task #${fromNumber} moved to position #${toNumber}: "${movedTask.task_name}"`
      };
    }
  }

  // Fallback for tables without 'position' column:
  // Re-assign task_name in sorted id slots so order('id', { ascending: true }) matches reordered priority
  const sortedSlotIds = [...tasks].map(t => t.id).sort((a, b) => (a > b ? 1 : -1));
  for (let i = 0; i < sortedSlotIds.length; i++) {
    const slotId = sortedSlotIds[i];
    const newTaskName = reordered[i].task_name;
    const { error: slotErr } = await supabase
      .from('tasks')
      .update({ task_name: newTaskName })
      .eq('id', slotId);

    if (slotErr) {
      throw new Error(`Database error while reordering tasks: ${slotErr.message}`);
    }
  }

  return {
    success: true,
    message: `Task #${fromNumber} moved to position #${toNumber}: "${movedTask.task_name}"`
  };
}
