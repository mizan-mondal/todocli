import { createClient } from '@supabase/supabase-js';

const CONFIG_STORAGE_KEY = 'todocli_supabase_config';
let supabaseClient = null;

// In-memory salt cache to minimize network roundtrips during session operations
const saltCache = new Map();

/**
 * Retrieve active Supabase credentials from deployment environment (Vercel) or browser config
 */
export function getSupabaseConfig() {
  // 1. Check deployment environment variables first (Vercel / Vite - authoritative)
  const envUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
  const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

  if (envUrl && envKey && !envUrl.includes('your-project-id')) {
    return { url: envUrl, key: envKey, source: 'env' };
  }

  // 2. Fallback to browser configuration for local developer testing
  try {
    const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.url && parsed.key) {
        return { url: parsed.url.trim(), key: parsed.key.trim(), source: 'browser' };
      }
    }
  } catch (e) {}

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
// Supabase Database Operations (Protected via Stored Procedures & RLS)
// =============================================================================

export async function dbCreateUser(username, password) {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Database service is not configured.');
  }

  const cleanUser = username.trim();
  const salt = generateHexSalt();
  const hash = await hashPassword(password, salt);

  // 1. Attempt secure RPC call (preferred, RLS-enforced)
  try {
    const { data, error } = await supabase.rpc('todocli_create_user', {
      p_username: cleanUser,
      p_password_hash: hash,
      p_password_salt: salt
    });

    if (!error && data) {
      if (data.success) {
        saltCache.set(cleanUser, salt);
      }
      return data;
    }
    // If error is other than function missing, throw
    if (error && !error.message?.includes('function') && error.code !== 'PGRST202') {
      throw new Error(`Database error while creating user: ${error.message}`);
    }
  } catch (rpcErr) {
    if (!rpcErr.message?.includes('function') && !rpcErr.message?.includes('PGRST202')) {
      throw rpcErr;
    }
  }

  // 2. Direct fallback (for legacy schema without RPC migration)
  const { data: existing, error: checkError } = await supabase
    .from('users')
    .select('username')
    .eq('username', cleanUser)
    .maybeSingle();

  if (checkError) {
    throw new Error(`Database error while checking user: ${checkError.message}`);
  }

  if (existing) {
    return { success: false, message: `Error: User '${cleanUser}' already exists.` };
  }

  const { error: insertError } = await supabase
    .from('users')
    .insert([{ username: cleanUser, password_hash: hash, password_salt: salt }]);

  if (insertError) {
    throw new Error(`Database error while creating user: ${insertError.message}`);
  }

  saltCache.set(cleanUser, salt);
  return { success: true, message: `User '${cleanUser}' created successfully.` };
}

export async function dbAuthenticateUser(username, password) {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Database service is not configured.');
  }

  const cleanUser = username.trim();

  // 1. Attempt secure RPC authentication
  try {
    let salt = saltCache.get(cleanUser);
    if (!salt) {
      const { data: saltData, error: saltError } = await supabase.rpc('todocli_get_salt', {
        p_username: cleanUser
      });

      if (!saltError && saltData && saltData.length > 0 && saltData[0].salt) {
        salt = saltData[0].salt;
        saltCache.set(cleanUser, salt);
      }
    }

    if (salt) {
      const hash = await hashPassword(password, salt);
      const { data: authData, error: authError } = await supabase.rpc('todocli_authenticate', {
        p_username: cleanUser,
        p_password_hash: hash
      });

      if (!authError && authData) {
        if (authData.success) {
          return {
            success: true,
            user: { username: cleanUser, password_hash: hash, password_salt: salt }
          };
        } else {
          return { success: false, message: authData.message || 'Authentication failed: Invalid username or password.' };
        }
      }
    }
  } catch (rpcErr) {
    // If RPC is missing, continue to legacy fallback
  }

  // 2. Direct fallback (for legacy schema without RPC migration)
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('username', cleanUser)
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

  saltCache.set(cleanUser, user.password_salt);
  return { success: true, user };
}

async function fetchUserTasksLegacy(supabase, username) {
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
  const cleanUser = username.trim();

  // 1. Attempt secure RPC call
  try {
    const { data, error } = await supabase.rpc('todocli_list_tasks', {
      p_username: cleanUser,
      p_password_hash: auth.user.password_hash
    });

    if (!error && data && data.success) {
      const tasks = data.tasks || [];
      if (tasks.length === 0) {
        return { success: true, message: `No tasks found for user '${cleanUser}'.`, tasks: [] };
      }
      const formatted = tasks.map((t, idx) => `${idx + 1}. ${t.task_name}`).join('\n');
      return { success: true, message: formatted, tasks };
    }
  } catch (rpcErr) {}

  // 2. Legacy fallback
  const { tasks } = await fetchUserTasksLegacy(supabase, cleanUser);
  if (!tasks || tasks.length === 0) {
    return { success: true, message: `No tasks found for user '${cleanUser}'.`, tasks: [] };
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
  const cleanUser = username.trim();

  // 1. Attempt secure RPC call
  try {
    const { data, error } = await supabase.rpc('todocli_add_task', {
      p_username: cleanUser,
      p_password_hash: auth.user.password_hash,
      p_task_name: taskName
    });

    if (!error && data) {
      return data;
    }
  } catch (rpcErr) {}

  // 2. Legacy fallback
  const { tasks, hasPosition } = await fetchUserTasksLegacy(supabase, cleanUser);
  const nextPos = tasks.length + 1;

  let error = null;
  if (hasPosition) {
    const res = await supabase
      .from('tasks')
      .insert([{ username: cleanUser, task_name: taskName, position: nextPos }]);
    error = res.error;
  } else {
    const res = await supabase
      .from('tasks')
      .insert([{ username: cleanUser, task_name: taskName }]);
    error = res.error;
  }

  if (error && error.message && error.message.toLowerCase().includes('position')) {
    const fallback = await supabase
      .from('tasks')
      .insert([{ username: cleanUser, task_name: taskName }]);
    error = fallback.error;
  }

  if (error) {
    throw new Error(`Database error while adding task: ${error.message}`);
  }

  return { success: true, message: `Task added: "${taskName}"` };
}

export async function dbDeleteTask(username, password, taskNumberInput) {
  const auth = await dbAuthenticateUser(username, password);
  if (!auth.success) {
    return { success: false, message: auth.message };
  }

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
        return {
          success: false,
          message: `Error: Invalid task number '${p}'. Must be a positive integer.`
        };
      }
      rawNumbers.push(parsed);
    }
  }

  if (rawNumbers.length === 0) {
    return {
      success: false,
      message: 'Error: Missing task number. Usage: delete task <task_number>'
    };
  }

  const supabase = getSupabase();
  const cleanUser = username.trim();

  // 1. Attempt secure RPC call
  try {
    const { data, error } = await supabase.rpc('todocli_delete_tasks', {
      p_username: cleanUser,
      p_password_hash: auth.user.password_hash,
      p_task_numbers: rawNumbers
    });

    if (!error && data) {
      return data;
    }
  } catch (rpcErr) {}

  // 2. Legacy fallback
  const { tasks, hasPosition } = await fetchUserTasksLegacy(supabase, cleanUser);

  if (!tasks || tasks.length === 0) {
    return {
      success: false,
      message: `Error: Task not found. No tasks exist for user '${cleanUser}'.`
    };
  }

  for (const num of rawNumbers) {
    if (num < 1 || num > tasks.length) {
      return {
        success: false,
        message: `Error: Task #${num} not found. Use 'list' to view current tasks.`
      };
    }
  }

  const uniqueNumbers = Array.from(new Set(rawNumbers)).sort((a, b) => a - b);
  const targetTasks = uniqueNumbers.map(num => ({ number: num, task: tasks[num - 1] }));
  const targetIds = targetTasks.map(t => t.task.id);

  const { error: deleteError } = await supabase
    .from('tasks')
    .delete()
    .in('id', targetIds);

  if (deleteError) {
    throw new Error(`Database error while deleting task: ${deleteError.message}`);
  }

  if (hasPosition) {
    const targetIdSet = new Set(targetIds);
    const remaining = tasks.filter(t => !targetIdSet.has(t.id));
    for (let i = 0; i < remaining.length; i++) {
      await supabase
        .from('tasks')
        .update({ position: i + 1 })
        .eq('id', remaining[i].id);
    }
  }

  if (targetTasks.length === 1) {
    return { success: true, message: `Task #${targetTasks[0].number} deleted: "${targetTasks[0].task.task_name}"` };
  }

  const msg = targetTasks.map(t => `Task #${t.number} deleted: "${t.task.task_name}"`).join('\n');
  return { success: true, message: msg };
}

export async function dbPriorityTask(username, password, fromNumber, toNumber) {
  const auth = await dbAuthenticateUser(username, password);
  if (!auth.success) {
    return { success: false, message: auth.message };
  }

  const supabase = getSupabase();
  const cleanUser = username.trim();

  // 1. Attempt secure RPC call
  try {
    const { data, error } = await supabase.rpc('todocli_priority_task', {
      p_username: cleanUser,
      p_password_hash: auth.user.password_hash,
      p_from: fromNumber,
      p_to: toNumber
    });

    if (!error && data) {
      return data;
    }
  } catch (rpcErr) {}

  // 2. Legacy fallback
  const { tasks, hasPosition } = await fetchUserTasksLegacy(supabase, cleanUser);

  if (tasks.length === 0) {
    return { success: false, message: `No tasks found for user '${cleanUser}'.` };
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

  const reordered = [...tasks];
  const [movedTask] = reordered.splice(fromNumber - 1, 1);
  reordered.splice(toNumber - 1, 0, movedTask);

  if (hasPosition) {
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
