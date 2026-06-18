import { supabase } from "./supabase";
import type { UserProfile } from "./supabase";

export type MatchStrength = "strong" | "good" | "possible";

export type JobMatch = {
  id: string;
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

// Generic role suffixes that appear in many job titles without adding specificity —
// "Sales Agent" matching every "X Agent" job is the canonical failure case.
const TITLE_STOPWORDS = new Set(["agent"]);

// Stem expansions: each entry maps a root to the set of forms that should match each other.
// When a term matches any form in a group, all forms are added to the search set.
const STEM_GROUPS: string[][] = [
  ["market", "marketing", "marketer", "markets"],
  ["manage", "manager", "management", "managing"],
  ["admin", "administration", "administrative", "administrator"],
  ["develop", "developer", "development", "developing"],
  ["design", "designer", "designing"],
  ["sell", "sales", "selling", "seller"],
  ["account", "accountant", "accounting", "accounts"],
  ["drive", "driver", "driving"],
  ["clean", "cleaner", "cleaning"],
  ["cook", "cooker", "cooking"],
  ["teach", "teacher", "teaching"],
  ["assist", "assistant", "assisting"],
  ["reception", "receptionist"],
  ["finance", "financial", "financing"],
  ["communicate", "communication", "communications"],
  ["coordinate", "coordinator", "coordinating"],
];

// Build a lookup: term → all related terms (including itself)
const STEM_MAP = new Map<string, string[]>();
for (const group of STEM_GROUPS) {
  for (const word of group) {
    STEM_MAP.set(word, group);
  }
}

function expandTerms(terms: string[]): string[] {
  const expanded = new Set(terms);
  for (const term of terms) {
    const related = STEM_MAP.get(term);
    if (related) related.forEach((r) => expanded.add(r));
  }
  return Array.from(expanded);
}

function tokenise(text: string, stopwords?: Set<string>): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopwords?.has(w));
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

  const skillTerms = expandTerms((profile.skills ?? []).map((s) => s.toLowerCase()));

  const experienceTerms = expandTerms(
    (profile.work_experience ?? []).flatMap((w) => [
      ...(w.title ? tokenise(w.title, TITLE_STOPWORDS) : []),
      ...(w.duties ?? []).flatMap((d) => tokenise(d)),
      ...(w.responsibilities ?? []).flatMap((r) => tokenise(r)),
    ])
  );

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

    // Location
    if (userLocation && jobLocation.includes(userLocation)) {
      score += 10;
    } else if (jobLocation.includes("cape town")) {
      score += 5;
    }

    // Skills — highest weight, title match especially valuable
    for (const term of skillTerms) {
      if (titleLower.includes(term)) score += 8;
      if (descLower.includes(term))  score += 3;
      if (reqsText.includes(term))   score += 3;
    }

    // Work experience — job titles + duties/responsibilities
    for (const term of experienceTerms) {
      if (titleLower.includes(term)) score += 6;
      if (descLower.includes(term))  score += 2;
      if (reqsText.includes(term))   score += 2;
    }

    // Education — lower weight, useful for professional roles
    for (const term of educationTerms) {
      if (searchable.includes(term)) score += 2;
    }

    // Message keyword intent
    for (const word of messageWords) {
      if (titleLower.includes(word)) score += 7;
      if (descLower.includes(word))  score += 3;
      if (reqsText.includes(word))   score += 3;
    }

    // Determine match strength from total score
    const match_strength: MatchStrength =
      score >= 20 ? "strong" : score >= 12 ? "good" : "possible";

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
    id: job.id,
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
