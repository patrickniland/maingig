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
  cv_full_name: string | null;
  email: string | null;
  location_area: string | null;
  status: string;
  preferred_language: Language | null;
  created_at: string;
  dashboard_token: string | null;
  token_expires_at: string | null;
  last_active: string | null;
};

export type WorkExperience = {
  title?: string;
  company?: string;
  start_date?: string;
  end_date?: string;
  responsibilities?: string[];
  duties?: string[];
};

export type Education = {
  qualification?: string;
  institution?: string;
  date_range?: string;
  description?: string;
};

export type Referee = {
  name?: string;
  role?: string;
  phone?: string;
};

export type UserProfile = {
  id?: string;
  user_id: string;
  job_title: string | null;
  education_level: string | null;
  education: Education[] | null;
  skills: string[] | null;
  work_experience: WorkExperience[] | null;
  availability: string | null;
  awards: string[] | null;
  languages_spoken: string[] | null;
  interests: string[] | null;
  references: Referee[] | null;
  cv_generated: boolean | null;
  cv_url: string | null;
  profile_complete: boolean | null;
  profile_score: number | null;
  last_job_matches?: Record<string, unknown>[] | null;
};

export type PointsAndStreaks = {
  user_id: string;
  total_points: number;
  current_streak_days: number;
  last_activity_date: string | null;
  level: number;
};

export type Message = {
  id: string;
  user_id: string;
  message_role: "user" | "assistant";
  message_content: string;
  created_at: string;
};
