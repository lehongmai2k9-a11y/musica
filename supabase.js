export const SUPABASE_URL =
  "https://andscyqgcbqdxbawfezk.supabase.co";

export const SUPABASE_ANON_KEY =
  "sb_publishable_7oCdwGCpWOjAXi5wp19Vyg_2-caH39F";

export function supabaseReady() {
  return (
    SUPABASE_URL.startsWith("https://") &&
    SUPABASE_ANON_KEY.startsWith("sb_")
  );
}