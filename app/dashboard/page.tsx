import { supabase } from "@/lib/supabase";
import type { User, UserProfile, PointsAndStreaks } from "@/lib/supabase";

// ── Data fetching ──────────────────────────────────────────────────────────

async function getDashboardData(token: string): Promise<{
  user: User;
  profile: UserProfile | null;
  stats: PointsAndStreaks | null;
} | null> {
  const { data: user, error } = await supabase
    .from("users")
    .select("*")
    .eq("dashboard_token", token)
    .gt("token_expires_at", new Date().toISOString())
    .single();

  if (error || !user) return null;

  const [{ data: profile }, { data: stats }] = await Promise.all([
    supabase.from("user_profiles").select("*").eq("user_id", user.id).single(),
    supabase.from("points_and_streaks").select("*").eq("user_id", user.id).single(),
  ]);

  return { user, profile: profile ?? null, stats: stats ?? null };
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
        {title}
      </h2>
      {children}
    </div>
  );
}

function TagList({ items }: { items: string[] }) {
  if (!items.length) return <p className="text-sm text-gray-400">Not added yet</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className="bg-green-50 text-green-700 text-xs font-medium px-3 py-1 rounded-full"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 text-sm py-1.5">
      <span className="text-gray-400 w-20 shrink-0">{label}</span>
      <span className="text-gray-700 break-all">{value}</span>
    </div>
  );
}

type JobMatch = {
  title: string;
  company?: string | null;
  location_area?: string;
  employment_type?: string | null;
  description?: string;
  application_url?: string | null;
  match_strength?: "strong" | "good" | "possible";
};

function JobCard({ job }: { job: JobMatch }) {
  const strengthColour =
    job.match_strength === "strong"
      ? "bg-green-100 text-green-700"
      : job.match_strength === "good"
      ? "bg-yellow-100 text-yellow-700"
      : "bg-gray-100 text-gray-500";

  return (
    <div className="border border-gray-100 rounded-xl p-4 mb-3 last:mb-0">
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="font-semibold text-sm text-gray-800 leading-snug">{job.title}</p>
        {job.match_strength && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${strengthColour}`}>
            {job.match_strength}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-400 mb-2">
        {[job.location_area, job.employment_type].filter(Boolean).join(" · ")}
      </p>
      {job.description && (
        <p className="text-xs text-gray-500 mb-3 leading-relaxed">{job.description}</p>
      )}
      {job.application_url && (
        <a
          href={job.application_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-xs font-semibold bg-green-800 text-white px-4 py-2 rounded-lg"
        >
          Apply now
        </a>
      )}
    </div>
  );
}

// ── Error / loading states ─────────────────────────────────────────────────

function ErrorPage({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6 text-center">
      <div className="text-4xl mb-4">🔒</div>
      <h1 className="text-lg font-bold text-gray-800 mb-2">Link expired</h1>
      <p className="text-sm text-gray-500 max-w-xs">{message}</p>
      <p className="text-sm text-gray-400 mt-4">
        Message Sisi on WhatsApp to get a new link.
      </p>
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
    return (
      <ErrorPage message="This link has expired or is invalid. Ask Sisi to send you a new one." />
    );
  }

  const { user, profile, stats } = result;
  const displayName = user.full_name ?? user.phone_number;
  const jobMatches: JobMatch[] = [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Header ── */}
      <div className="bg-green-800 text-white px-5 pt-10 pb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-green-100 mb-1">
          MainGig
        </p>
        <h1 className="text-2xl font-bold leading-tight">{displayName}</h1>
      </div>

      {/* ── Body ── */}
      <div className="px-4 pt-5 pb-10 max-w-lg mx-auto">

        {/* Streak & Points */}
        {stats && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="text-2xl">🔥</div>
              <div>
                <p className="text-lg font-bold text-gray-800 leading-none">
                  {stats.current_streak_days} day{stats.current_streak_days !== 1 ? "s" : ""}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">current streak</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-green-800 leading-none">{stats.total_points} pts</p>
              <p className="text-xs text-gray-400 mt-0.5">Level {stats.level}</p>
            </div>
          </div>
        )}

        {/* Profile */}
        <Section title="Profile">
          <InfoRow label="Phone"    value={user.phone_number} />
          <InfoRow label="Email"    value={user.email} />
          <InfoRow label="Location" value={user.location_area} />
          <InfoRow label="Available" value={profile?.availability ?? null} />
        </Section>

        {/* Skills */}
        <Section title="Skills">
          <TagList items={profile?.skills ?? []} />
        </Section>

        {/* Education */}
        {(profile?.education_level || profile?.education?.length) && (
          <Section title="Education">
            {profile.education?.length ? (
              profile.education.map((edu, i) => (
                <div key={i} className="mb-3 last:mb-0">
                  {edu.qualification && (
                    <p className="text-sm font-semibold text-gray-800">{edu.qualification}</p>
                  )}
                  {edu.institution && (
                    <p className="text-xs text-gray-500">{edu.institution}</p>
                  )}
                  {edu.date_range && (
                    <p className="text-xs text-gray-400">{edu.date_range}</p>
                  )}
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-700">{profile.education_level}</p>
            )}
          </Section>
        )}

        {/* Work Experience */}
        {profile?.work_experience?.length && (
          <Section title="Work Experience">
            {profile.work_experience.map((job, i) => {
              const dateRange = [job.start_date, job.end_date ?? "Present"]
                .filter(Boolean)
                .join(" – ");
              const bullets = job.duties ?? job.responsibilities ?? [];
              return (
                <div key={i} className="mb-5 last:mb-0">
                  {job.title && (
                    <p className="text-sm font-semibold text-gray-800">{job.title}</p>
                  )}
                  <div className="flex justify-between items-baseline gap-2 mt-0.5">
                    {job.company && (
                      <p className="text-xs text-gray-500">{job.company}</p>
                    )}
                    {dateRange && (
                      <p className="text-xs text-gray-400 shrink-0">{dateRange}</p>
                    )}
                  </div>
                  {bullets.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {bullets.map((b, j) => (
                        <li key={j} className="text-xs text-gray-500 flex gap-1.5">
                          <span className="shrink-0">•</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </Section>
        )}

        {/* Languages */}
        {profile?.languages_spoken?.length && (
          <Section title="Languages">
            <TagList items={profile.languages_spoken} />
          </Section>
        )}

        {/* CV */}
        <Section title="Your CV">
          {profile?.cv_url ? (
            <div className="flex flex-col gap-3">
              <a
                href={profile.cv_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 bg-green-800 text-white font-semibold text-sm rounded-xl py-3 px-5"
              >
                <span>⬇</span> Download CV
              </a>
              <a
                href="https://wa.me/14155238886?text=Please+regenerate+my+CV"
                className="flex items-center justify-center gap-2 border border-green-800 text-green-800 font-semibold text-sm rounded-xl py-3 px-5"
              >
                Regenerate CV
              </a>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-400 mb-3">
                No CV generated yet. Ask Sisi to create one.
              </p>
              <a
                href="https://wa.me/14155238886?text=Please+generate+my+CV"
                className="inline-flex items-center gap-2 bg-green-800 text-white font-semibold text-sm rounded-xl py-3 px-5"
              >
                Generate my CV
              </a>
            </div>
          )}
        </Section>

        {/* Job matches */}
        <Section title="Job Matches">
          {jobMatches.length > 0 ? (
            jobMatches.slice(0, 3).map((job, i) => <JobCard key={i} job={job} />)
          ) : (
            <div>
              <p className="text-sm text-gray-400 mb-3">
                No job matches yet. Ask Sisi to find jobs for you.
              </p>
              <a
                href="https://wa.me/14155238886?text=Can+you+find+jobs+for+me"
                className="inline-flex items-center gap-2 bg-green-800 text-white font-semibold text-sm rounded-xl py-3 px-5"
              >
                Find jobs
              </a>
            </div>
          )}
        </Section>

      </div>

      {/* Floating chat button */}
      <a
        href="https://wa.me/14155238886"
        className="fixed bottom-4 right-4 bg-green-800 text-white font-semibold text-sm rounded-full py-3 px-5 shadow-lg"
      >
        💬 Chat with Sisi
      </a>
    </div>
  );
}
