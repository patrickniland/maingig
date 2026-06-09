import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Service-role client for server-side use only — never expose to the browser.
export const supabase = createClient(supabaseUrl, supabaseServiceKey);

export type User = {
  id: string;
  phone: string;
  name: string | null;
  status: string;
  created_at: string;
};

export type Message = {
  id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};
