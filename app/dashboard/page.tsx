import { supabase } from "@/lib/supabase";
import type { User, UserProfile, PointsAndStreaks } from "@/lib/supabase";
import DashboardTabs from "./DashboardTabs";
import type { JobMatch, JobPosting } from "./DashboardTabs";

// ── Data fetching ──────────────────────────────────────────────────────────

async function getDashboardData(token: string): Promise<{
  user: User;
  profile: UserProfile | null;
  stats: PointsAndStreaks | null;
  jobMatches: JobMatch[];
  jobPostings: JobPosting[];
} | null> {
  const { data: user, error } = await supabase
    .from("users")
    .select("*")
    .eq("dashboard_token", token)
    .gt("token_expires_at", new Date().toISOString())
    .single();

  if (error || !user) return null;

  const [{ data: profile }, { data: points }] = await Promise.all([
    supabase.from("user_profiles").select("*").eq("user_id", user.id).single(),
    supabase.from("points_and_streaks").select("*").eq("user_id", user.id).single(),
  ]);

  // Fetch employer job postings for this phone number
  const { data: employer } = await supabase
    .from("employers")
    .select("id")
    .eq("contact_phone", user.phone_number)
    .single();

  let jobPostings: JobPosting[] = [];
  if (employer) {
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id, title, location_area, employment_type, created_at, active")
      .eq("employer_id", employer.id)
      .order("created_at", { ascending: false });
    jobPostings = (jobs ?? []) as JobPosting[];
  }

  const jobMatches = (profile?.last_job_matches as JobMatch[] | null) ?? [];

  return {
    user,
    profile: profile ?? null,
    stats: points ?? null,
    jobMatches,
    jobPostings,
  };
}

// ── Error state ────────────────────────────────────────────────────────────

function ErrorPage({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6 text-center">
      <div className="text-4xl mb-4">🔒</div>
      <h1 className="text-lg font-bold text-gray-800 mb-2">Link expired</h1>
      <p className="text-sm text-gray-500 max-w-xs">{message}</p>
      <p className="text-sm text-gray-400 mt-4">Message Sisi on WhatsApp to get a new link.</p>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params.token;

  if (!token) {
    return <ErrorPage message="No access token found in URL." />;
  }

  const result = await getDashboardData(token);
  if (!result) {
    return <ErrorPage message="This link has expired or is invalid. Ask Sisi to send you a new one." />;
  }

  const { user, profile, stats, jobMatches, jobPostings } = result;
  const displayName = user.full_name ?? user.phone_number;

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Header ── */}
      <div className="bg-green-800 text-white px-5 pt-10 pb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-green-100 mb-1">
          MainGig
        </p>
        <h1 className="text-2xl font-bold leading-tight mb-3">{displayName}</h1>

        {stats && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1 bg-green-700 rounded-full px-3 py-1 text-xs font-semibold">
              🔥 {stats.current_streak_days} day{stats.current_streak_days !== 1 ? "s" : ""}
            </span>
            <span className="flex items-center gap-1 bg-green-700 rounded-full px-3 py-1 text-xs font-semibold">
              ⭐ {stats.total_points} pts
            </span>
            <span className="flex items-center gap-1 bg-green-700 rounded-full px-3 py-1 text-xs font-semibold">
              Level {stats.level}
            </span>
          </div>
        )}
      </div>

      {/* ── Tabs (client component) ── */}
      <DashboardTabs
        phoneNumber={user.phone_number}
        email={user.email}
        locationArea={user.location_area}
        profile={profile}
        stats={stats}
        jobMatches={jobMatches}
        jobPostings={jobPostings}
      />

    </div>
  );
}
