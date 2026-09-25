export const env = {
  apiUrl: (import.meta.env.WXT_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:8787',
  authMode: ((import.meta.env.WXT_AUTH_MODE as string | undefined) ?? 'supabase') as 'supabase' | 'dev',
  supabaseUrl: import.meta.env.WXT_SUPABASE_URL as string | undefined,
  supabaseAnonKey: import.meta.env.WXT_SUPABASE_ANON_KEY as string | undefined,
};
