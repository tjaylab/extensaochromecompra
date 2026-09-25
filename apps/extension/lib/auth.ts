import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

// Session storage for supabase-js backed by chrome.storage.local (the side panel has no persistent localStorage guarantees).
const chromeStorage = {
  getItem: async (key: string) => ((await chrome.storage.local.get(key))[key] as string | undefined) ?? null,
  setItem: async (key: string, value: string) => chrome.storage.local.set({ [key]: value }),
  removeItem: async (key: string) => chrome.storage.local.remove(key),
};

let supabase: SupabaseClient | null = null;
function client() {
  if (!supabase) {
    if (!env.supabaseUrl || !env.supabaseAnonKey) throw new Error('Configure WXT_SUPABASE_URL e WXT_SUPABASE_ANON_KEY');
    supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { storage: chromeStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return supabase;
}

const DEV_KEY = 'devSessionEmail';

export async function getToken(): Promise<string | null> {
  if (env.authMode === 'dev') {
    const email = (await chrome.storage.local.get(DEV_KEY))[DEV_KEY] as string | undefined;
    return email ? `dev:${email}` : null;
  }
  const { data } = await client().auth.getSession();
  return data.session?.access_token ?? null;
}

export async function signIn(email: string, password: string): Promise<void> {
  if (env.authMode === 'dev') {
    await chrome.storage.local.set({ [DEV_KEY]: email.trim().toLowerCase() });
    return;
  }
  const { error } = await client().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos' : error.message);
}

export async function signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }> {
  if (env.authMode === 'dev') {
    await signIn(email, password);
    return { needsConfirmation: false };
  }
  const { data, error } = await client().auth.signUp({ email: email.trim(), password });
  if (error) throw new Error(error.message);
  return { needsConfirmation: !data.session };
}

export async function signOut(): Promise<void> {
  if (env.authMode === 'dev') {
    await chrome.storage.local.remove(DEV_KEY);
    return;
  }
  await client().auth.signOut();
}
