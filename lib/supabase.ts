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
  location_area: string | null;
  status: string;
  preferred_language: Language | null;
  created_at: string;
};

export type WorkExperience = {
  role?: string;
  company?: string;
  duration?: string;
};

export type UserProfile = {
  id?: string;
  user_id: string;
  education_level: string | null;
  skills: string[] | null;
  work_experience: WorkExperience[] | null;
  availability: string | null;
  cv_generated: boolean | null;
  cv_url: string | null;
  profile_complete: boolean | null;
  profile_score: number | null;
};

export type Message = {
  id: string;
  user_id: string;
  message_role: "user" | "assistant";
  message_content: string;
  created_at: string;
};
