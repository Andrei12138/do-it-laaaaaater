import { createClient } from '@supabase/supabase-js'

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim()
const supabaseKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()

export const cloudEnabled = Boolean(supabaseUrl && supabaseKey)

export const supabase = cloudEnabled
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null

export function requireSupabase() {
  if (!supabase) throw new Error('云端连接尚未配置')
  return supabase
}

export function subscribeCloudAuth(listener: (event: string) => void) {
  if (!supabase) return () => undefined
  const { data } = supabase.auth.onAuthStateChange((event) => listener(event))
  return () => data.subscription.unsubscribe()
}
