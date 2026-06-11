import { supabase } from "./supabase";
import type { UserProfile } from "./supabase";

export type MatchStrength = "strong" | "good" | "possible";

export type JobMatch = {
  title: string;
  company: string | null;
  location_area: string;
  employment_type: string | null;
  description: string;
  application_url: string | null;
  requirements: string[];
  match_strength: MatchStrength;
};

type RawJob = {
  id: string;
  title: string;
  description: string | null;
  location_area: string | null;
  employment_type: string | null;
  application_url: string | null;
  requirements: string[] | null;
};

function tokenise(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
}

function anyMatch(terms: string[], haystack: string): boolean {
  return terms.some((t) => haystack.includes(t));
}

export async function matchJobs(
  profile: UserProfile,
  locationArea: string | null,
  userMessage?: string
): Promise<JobMatch[]> {
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, title, description, location_area, employment_type, application_url, requirements")
    .eq("active", true)
    .eq("verified", true)
    .limit(300);

  console.log("[matcher] Total jobs loaded:", jobs?.length);

  if (error || !jobs?.length) return [];

  // ── Build search term sets ────────────────────────────────────────────────

  const skillTerms = (profile.skills ?? []).map((s) => s.toLowerCase());

  const experienceTerms = (profile.work_experience ?? []).flatMap((w) => [
    ...(w.title ? tokenise(w.title) : []),
    ...(w.duties ?? []).flatMap((d) => tokenise(d)),
    ...(w.responsibilities ?? []).flatMap((r) => tokenise(r)),
  ]);

  const educationTerms = tokenise(profile.education_level ?? "");

  const messageWords = tokenise(userMessage ?? "");
  const userLocation = (locationArea ?? "").toLowerCase();

  console.log("[matcher] Skill terms:", skillTerms);
  console.log("[matcher] Experience terms (sample):", experienceTerms.slice(0, 10));
  console.log("[matcher] Education terms:", educationTerms);
  console.log("[matcher] Message words:", messageWords);

  // ── Score each job ────────────────────────────────────────────────────────

  const scored = (jobs as unknown as RawJob[]).map((job) => {
    const titleLower = (job.title ?? "").toLowerCase();
    const descLower = (job.description ?? "").toLowerCase();
    const reqsText = (job.requirements ?? []).join(" ").toLowerCase();
    const jobLocation = (job.location_area ?? "").toLowerCase();
    const searchable = `${titleLower} ${descLower} ${reqsText}`;

    let score = 0;
    let skillHit = false;
    let experienceHit = false;
    let educationHit = false;

    // Location
    if (userLocation && jobLocation.includes(userLocation)) {
      score += 10;
    } else if (jobLocation.includes("cape town")) {
      score += 5;
    }

    // Skills — highest weight, title match especially valuable
    for (const term of skillTerms) {
      if (titleLower.includes(term)) { score += 8; skillHit = true; }
      if (descLower.includes(term))  { score += 3; skillHit = true; }
      if (reqsText.includes(term))   { score += 3; skillHit = true; }
    }

    // Work experience — job titles + duties/responsibilities
    for (const term of experienceTerms) {
      if (titleLower.includes(term)) { score += 6; experienceHit = true; }
      if (descLower.includes(term))  { score += 2; experienceHit = true; }
      if (reqsText.includes(term))   { score += 2; experienceHit = true; }
    }

    // Education — lower weight, useful for professional roles
    for (const term of educationTerms) {
      if (searchable.includes(term)) { score += 2; educationHit = true; }
    }

    // Message keyword intent
    for (const word of messageWords) {
      if (titleLower.includes(word)) score += 7;
      if (descLower.includes(word))  score += 3;
      if (reqsText.includes(word))   score += 3;
    }

    // Determine match strength from how many profile dimensions contributed
    const dimensions = [skillHit, experienceHit, educationHit].filter(Boolean).length;
    const match_strength: MatchStrength =
      dimensions >= 3 ? "strong" : dimensions === 2 ? "good" : "possible";

    return { job, score, match_strength };
  });

  console.log(
    "[matcher] Top scores:",
    scored
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((s) => ({ title: s.job.title, score: s.score, strength: s.match_strength }))
  );

  // ── Filter and rank ───────────────────────────────────────────────────────

  let candidates = scored.filter((s) => s.score > 5);
  if (candidates.length === 0) {
    candidates = scored.filter((s) => s.score > 0);
  }
  // Always return something — fall back to Cape Town jobs by location score
  if (candidates.length === 0) {
    candidates = scored.filter((s) =>
      s.job.location_area?.toLowerCase().includes("cape town")
    );
  }

  console.log("[matcher] Candidates after filter:", candidates.length);

  const top3 = candidates.sort((a, b) => b.score - a.score).slice(0, 3);

  return top3.map(({ job, match_strength }) => ({
    title: job.title,
    company: null,
    location_area: job.location_area ?? "Cape Town",
    employment_type: job.employment_type ?? null,
    description: (job.description ?? "").slice(0, 150),
    application_url: job.application_url ?? null,
    requirements: (job.requirements ?? []).slice(0, 3),
    match_strength,
  }));
}
