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
// Rate Limiting (Brute-Force & Denial-of-Service Protection)
// =============================================================================

const AUTH_RATE_LIMIT = {
  MAX_FAILED_ATTEMPTS: 5,
  WINDOW_MS: 60 * 1000,      // 60-second tracking window
  LOCKOUT_MS: 30 * 1000      // 30-second lockout cooldown
};

const REQUEST_RATE_LIMIT = {
  MAX_REQUESTS: 20,          // Max 20 requests per 10 seconds
  WINDOW_MS: 10 * 1000
};

const authFailures = new Map(); // username -> { count, firstAttempt, lockedUntil }
const requestTimestamps = [];   // timestamps of recent database requests

/**
 * Validates request frequency against sliding window threshold
 */
export function checkRequestRateLimit() {
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

/**
 * Checks if a user is currently locked out due to excessive failed logins
 */
export function checkAuthRateLimit(username) {
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

export function recordFailedAuth(username) {
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

export function resetAuthRateLimit(username) {
  const cleanUser = username.trim().toLowerCase();
  authFailures.delete(cleanUser);
}

// =============================================================================
// Supabase Database Operations (Protected via Stored Procedures & RLS)
// =============================================================================

export async function dbCreateUser(username, password) {
  const reqCheck = checkRequestRateLimit();
  if (!reqCheck.allowed) {
    return { success: false, message: reqCheck.message };
  }

  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Database service is not configured.');
  }

  const cleanUser = username.trim();
  const salt = generateHexSalt();
  const hash = await hashPassword(password, salt);

  // Attempt secure RPC call (RLS-enforced)
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

export async function dbAuthenticateUser(username, password) {
  const cleanUser = username.trim();

  // 1. Check authentication brute-force rate limit
  const authLimitCheck = checkAuthRateLimit(cleanUser);
  if (!authLimitCheck.allowed) {
    return { success: false, message: authLimitCheck.message };
  }

  // 2. Check general request rate limit
  const reqCheck = checkRequestRateLimit();
  if (!reqCheck.allowed) {
    return { success: false, message: reqCheck.message };
  }

  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Database service is not configured.');
  }

  // 3. Retrieve salt via secure RPC (returns salt only, never password hashes)
  let salt = saltCache.get(cleanUser);
  if (!salt) {
    const { data: saltData, error: saltError } = await supabase.rpc('todocli_get_salt', {
      p_username: cleanUser
    });

    if (saltError) {
      if (saltError.code === 'PGRST202' || saltError.message?.includes('function') || saltError.message?.includes('not found')) {
        return {
          success: false,
          message: 'Database setup required: Please run "supabase/schema.sql" in your Supabase SQL Editor to enable secure procedures and Row Level Security.'
        };
      }
      return { success: false, message: `Database error: ${saltError.message}` };
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

  // 4. Compute hash locally and verify server-side via RPC
  const hash = await hashPassword(password, salt);
  const { data: authData, error: authError } = await supabase.rpc('todocli_authenticate', {
    p_username: cleanUser,
    p_password_hash: hash
  });

  if (authError) {
    if (authError.code === 'PGRST202' || authError.message?.includes('function') || authError.message?.includes('not found')) {
      return {
        success: false,
        message: 'Database setup required: Please run "supabase/schema.sql" in your Supabase SQL Editor to enable secure procedures and Row Level Security.'
      };
    }
    return { success: false, message: `Database error: ${authError.message}` };
  }

  if (authData && authData.success) {
    resetAuthRateLimit(cleanUser);
    return {
      success: true,
      user: { username: cleanUser, password_hash: hash, password_salt: salt }
    };
  } else {
    recordFailedAuth(cleanUser);
    const postLockout = checkAuthRateLimit(cleanUser);
    if (!postLockout.allowed) {
      return { success: false, message: postLockout.message };
    }
    return { success: false, message: authData?.message || 'Authentication failed: Invalid username or password.' };
  }
}

export async function dbListTasks(username, password) {
  const auth = await dbAuthenticateUser(username, password);
  if (!auth.success) {
    return { success: false, message: auth.message };
  }

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
    if (tasks.length === 0) {
      return { success: true, message: `No tasks found for user '${cleanUser}'.`, tasks: [] };
    }
    const formatted = tasks.map((t, idx) => `${idx + 1}. ${t.task_name}`).join('\n');
    return { success: true, message: formatted, tasks };
  }

  return { success: false, message: data?.message || 'Failed to list tasks.' };
}

export async function dbAddTask(username, password, taskName) {
  const auth = await dbAuthenticateUser(username, password);
  if (!auth.success) {
    return { success: false, message: auth.message };
  }

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

export async function dbPriorityTask(username, password, fromNumber, toNumber) {
  const auth = await dbAuthenticateUser(username, password);
  if (!auth.success) {
    return { success: false, message: auth.message };
  }

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
