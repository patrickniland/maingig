import { createClient } from "@supabase/supabase-js";

export type Language = "english" | "xhosa" | "zulu" | "afrikaans";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Service-role client for server-side use only — never expose to the browser.
export const supabase = createClient(supabaseUrl, supabaseServiceKey);

export type User = {
  id: string;
  phone_number: string;
  full_name: string | null;
  email: string | null;
  status: string;
  preferred_language: Language | null;
  created_at: string;
};

export type Message = {
  id: string;
  user_id: string;
  message_role: "user" | "assistant";
  message_content: string;
  created_at: string;
};
