import { supabase } from "./supabase";
import type { UserProfile } from "./supabase";

export type JobMatch = {
  title: string;
  company: string | null;
  location_area: string;
  employment_type: string | null;
  description: string;
  application_url: string | null;
  requirements: string[];
};

type RawJob = {
  id: string;
  title: string;
  description: string | null;
  location_area: string | null;
  employment_type: string | null;
  application_url: string | null;
  requirements: string[] | null;
  employers: { name: string }[] | null;
};

export async function matchJobs(
  profile: UserProfile,
  locationArea: string | null
): Promise<JobMatch[]> {
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, title, description, location_area, employment_type, application_url, requirements, employers(name)")
    .eq("active", true)
    .eq("verified", true)
    .limit(300);

  if (error || !jobs?.length) return [];

  const skills = (profile.skills ?? []).map((s) => s.toLowerCase());
  const expTitles = (profile.work_experience ?? [])
    .map((w) => (w.title ?? "").toLowerCase())
    .filter(Boolean);
  const userLocation = (locationArea ?? "").toLowerCase();

  const scored = (jobs as unknown as RawJob[]).map((job) => {
    let score = 0;

    const titleLower = (job.title ?? "").toLowerCase();
    const descLower = (job.description ?? "").toLowerCase();
    const reqsText = (job.requirements ?? []).join(" ").toLowerCase();
    const jobLocation = (job.location_area ?? "").toLowerCase();

    // Location: exact area match beats generic Cape Town
    if (userLocation && jobLocation.includes(userLocation)) {
      score += 10;
    } else if (jobLocation.includes("cape town")) {
      score += 5;
    }

    // Skill matches against title, description, requirements
    for (const skill of skills) {
      if (titleLower.includes(skill)) score += 8;
      if (descLower.includes(skill)) score += 3;
      if (reqsText.includes(skill)) score += 3;
    }

    // Prior job title matches
    for (const expTitle of expTitles) {
      if (titleLower.includes(expTitle)) score += 6;
      else if (descLower.includes(expTitle)) score += 2;
    }

    return { job, score };
  });

  // Prefer jobs with a skill/experience signal; fall back to location-only
  let candidates = scored.filter((s) => s.score > 5);
  if (candidates.length === 0) {
    candidates = scored.filter((s) => s.score > 0);
  }

  const top3 = candidates.sort((a, b) => b.score - a.score).slice(0, 3);

  return top3.map(({ job }) => ({
    title: job.title,
    company: job.employers?.[0]?.name ?? null,
    location_area: job.location_area ?? "Cape Town",
    employment_type: job.employment_type ?? null,
    description: (job.description ?? "").slice(0, 150),
    application_url: job.application_url ?? null,
    requirements: (job.requirements ?? []).slice(0, 3),
  }));
}
