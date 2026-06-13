"use client";

import { useState } from "react";
import type { UserProfile, PointsAndStreaks, WorkExperience } from "@/lib/supabase";

export type JobMatch = {
  title: string;
  company?: string | null;
  location_area?: string;
  employment_type?: string | null;
  description?: string;
  application_url?: string | null;
  match_strength?: "strong" | "good" | "possible";
};

export type JobPosting = {
  id: string;
  title: string;
  location_area: string | null;
  employment_type: string | null;
  created_at: string;
  active: boolean;
};

type Props = {
  phoneNumber: string;
  email: string | null;
  locationArea: string | null;
  profile: UserProfile | null;
  stats: PointsAndStreaks | null;
  jobMatches: JobMatch[];
  jobPostings: JobPosting[];
};

// ── Shared sub-components ────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
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
        <span key={item} className="bg-green-50 text-green-700 text-xs font-medium px-3 py-1 rounded-full">
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

function WorkExperienceSection({ jobs }: { jobs: WorkExperience[] }) {
  return (
    <Section title="Work Experience">
      {jobs.map((job, i) => {
        const dateRange = [job.start_date, job.end_date ?? "Present"].filter(Boolean).join(" – ");
        const bullets = job.duties ?? job.responsibilities ?? [];
        return (
          <div key={i} className="mb-5 last:mb-0">
            {job.title && <p className="text-sm font-semibold text-gray-800">{job.title}</p>}
            <div className="flex justify-between items-baseline gap-2 mt-0.5">
              {job.company && <p className="text-xs text-gray-500">{job.company}</p>}
              {dateRange && <p className="text-xs text-gray-400 shrink-0">{dateRange}</p>}
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
  );
}

// ── Tab content ───────────────────────────────────────────────────────────────

function SeekerTab({
  phoneNumber,
  email,
  locationArea,
  profile,
  jobMatches,
}: {
  phoneNumber: string;
  email: string | null;
  locationArea: string | null;
  profile: UserProfile | null;
  jobMatches: JobMatch[];
}) {
  return (
    <>
      <div className="md:grid md:grid-cols-2 md:gap-6">
        {/* Left column */}
        <div>
          <Section title="Profile">
            <InfoRow label="Phone"     value={phoneNumber} />
            <InfoRow label="Email"     value={email} />
            <InfoRow label="Location"  value={locationArea} />
            <InfoRow label="Available" value={profile?.availability ?? null} />
          </Section>

          {!!profile?.work_experience?.length && (
            <WorkExperienceSection jobs={profile.work_experience} />
          )}

          <Section title="Skills">
            <TagList items={profile?.skills ?? []} />
          </Section>

          {!!profile?.languages_spoken?.length && (
            <Section title="Languages">
              <TagList items={profile.languages_spoken} />
            </Section>
          )}
        </div>

        {/* Right column */}
        <div>
          {(profile?.education_level || profile?.education?.length) && (
            <Section title="Education">
              {profile.education?.length ? (
                profile.education.map((edu, i) => (
                  <div key={i} className="mb-3 last:mb-0">
                    {edu.qualification && (
                      <p className="text-sm font-semibold text-gray-800">{edu.qualification}</p>
                    )}
                    {edu.institution && <p className="text-xs text-gray-500">{edu.institution}</p>}
                    {edu.date_range && <p className="text-xs text-gray-400">{edu.date_range}</p>}
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-700">{profile.education_level}</p>
              )}
            </Section>
          )}

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
      </div>

      {/* CV sticky footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 flex gap-3">
        {profile?.cv_url ? (
          <>
            <a
              href={profile.cv_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 bg-green-800 text-white text-center font-semibold text-sm rounded-xl py-3"
            >
              ⬇ Download CV
            </a>
            <a
              href="https://wa.me/14155238886?text=regenerate+my+cv"
              className="flex-1 border border-green-800 text-green-800 text-center font-semibold text-sm rounded-xl py-3"
            >
              Regenerate
            </a>
          </>
        ) : (
          <>
            <a
              href="https://wa.me/14155238886?text=Please+generate+my+CV"
              className="flex-1 bg-green-800 text-white text-center font-semibold text-sm rounded-xl py-3"
            >
              Generate my CV
            </a>
            <a
              href="https://wa.me/14155238886"
              className="flex-1 border border-green-800 text-green-800 text-center font-semibold text-sm rounded-xl py-3"
            >
              Chat with Sisi
            </a>
          </>
        )}
      </div>
    </>
  );
}

function EmployerTab({ jobPostings }: { jobPostings: JobPosting[] }) {
  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
  }

  return (
    <>
      {jobPostings.length > 0 ? (
        <div>
          {jobPostings.map((job) => (
            <div key={job.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="font-semibold text-sm text-gray-800 leading-snug">{job.title}</p>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${
                  job.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"
                }`}>
                  {job.active ? "Active" : "Inactive"}
                </span>
              </div>
              <p className="text-xs text-gray-400 mb-1">
                {[job.location_area, job.employment_type].filter(Boolean).join(" · ")}
              </p>
              <p className="text-xs text-gray-400">Posted {formatDate(job.created_at)}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 text-center">
          <p className="text-sm text-gray-400 mb-4">
            You haven&apos;t posted any jobs yet. Message Sisi to post your first listing free.
          </p>
          <a
            href="https://wa.me/14155238886?text=I+want+to+post+a+job"
            className="inline-flex items-center gap-2 bg-green-800 text-white font-semibold text-sm rounded-xl py-3 px-5"
          >
            Post a job with Sisi
          </a>
        </div>
      )}

      {/* Sticky footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 flex gap-3">
        <a
          href="https://wa.me/14155238886?text=I+want+to+post+a+job"
          className="flex-1 bg-green-800 text-white text-center font-semibold text-sm rounded-xl py-3"
        >
          Post a new job
        </a>
        <a
          href="https://wa.me/14155238886"
          className="flex-1 border border-green-800 text-green-800 text-center font-semibold text-sm rounded-xl py-3"
        >
          Chat with Sisi
        </a>
      </div>
    </>
  );
}

// ── Main exported component ───────────────────────────────────────────────────

export default function DashboardTabs({ phoneNumber, email, locationArea, profile, stats, jobMatches, jobPostings }: Props) {
  const [activeTab, setActiveTab] = useState<"seeker" | "employer">("seeker");

  return (
    <>
      {/* Tab bar */}
      <div className="px-4 pt-4 max-w-4xl mx-auto">
        <div className="flex bg-gray-100 rounded-xl p-1 mb-5">
          <button
            onClick={() => setActiveTab("seeker")}
            className={`flex-1 text-sm font-semibold py-2 rounded-lg transition-colors ${
              activeTab === "seeker"
                ? "bg-green-800 text-white"
                : "text-gray-500"
            }`}
          >
            Find My Job
          </button>
          <button
            onClick={() => setActiveTab("employer")}
            className={`flex-1 text-sm font-semibold py-2 rounded-lg transition-colors ${
              activeTab === "employer"
                ? "bg-green-800 text-white"
                : "text-gray-500"
            }`}
          >
            My Job Posts
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="px-4 pb-24 max-w-4xl mx-auto">
        {activeTab === "seeker" ? (
          <SeekerTab phoneNumber={phoneNumber} email={email} locationArea={locationArea} profile={profile} jobMatches={jobMatches} />
        ) : (
          <EmployerTab jobPostings={jobPostings} />
        )}
      </div>
    </>
  );
}
