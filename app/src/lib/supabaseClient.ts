import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// ✅ 클라이언트 환경에서만 세션 자동 유지
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,       // 세션 유지
    autoRefreshToken: true,     // 토큰 자동 갱신
    detectSessionInUrl: true,   // OAuth 로그인 시 리다이렉트 처리
    storageKey: "supabase.auth.token", // 저장 키 명시
  },
});