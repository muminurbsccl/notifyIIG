export type PublicConfig = {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  configured: boolean;
};

export function getPublicConfig(): PublicConfig {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || null;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || null;
  return {
    supabaseUrl,
    supabaseAnonKey,
    configured: Boolean(supabaseUrl && supabaseAnonKey),
  };
}
