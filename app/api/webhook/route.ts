import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase";
import { callClaude } from "@/lib/claude";
import { sendWhatsAppMessage } from "@/lib/twilio";
import { generateCV } from "@/lib/cv-generator";
import { matchJobs } from "@/lib/job-matcher";
import type { JobMatch } from "@/lib/job-matcher";
import type { Message, Language, WorkExperience, Education, Referee } from "@/lib/supabase";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const LANGUAGE_GREETING =
  "Molo / Hello! I'm Sisi, your job coach. Which language would you like to chat in?\nReply: English, Xhosa, Zulu or Afrikaans.";

const LANGUAGE_TRIGGERS: Record<Language, RegExp> = {
  english:   /\b(english|english please|switch to english)\b/i,
  xhosa:     /\b(xhosa|isixhosa)\b/i,
  zulu:      /\b(zulu|isizulu|zulu please)\b/i,
  afrikaans: /\b(afrikaans|afrikaans please)\b/i,
};

const CV_REQUEST = /\b(cv|curriculum vitae|my cv|generate cv|create cv|send cv|get cv)\b/i;

const MODE_SEEKING = /\b(find work|looking for work|find me work|need a job|find a job|get a job|seeking work|want work|want a job|find work)\b/i;
const MODE_HIRING  = /\b(post a job|posting a job|i want to hire|need staff|find staff|find workers|recruit|i have a vacancy|post a vacancy|i want to post)\b/i;
const MODE_PROMPT  = "Are you looking for work, or are you hiring?\nReply: 1 for Looking for work, 2 for Looking to hire, 3 for Both";

const DASHBOARD_URL = "https://maingig.vercel.app/dashboard";

function levelFromPoints(pts: number): number {
  if (pts >= 500) return 5;
  if (pts >= 300) return 4;
  if (pts >= 150) return 3;
  if (pts >= 50)  return 2;
  return 1;
}

async function updatePointsAndStreaks(userId: string, pointsToAdd: number) {
  const today = new Date().toISOString().split("T")[0];

  const { data: existing } = await supabase
    .from("points_and_streaks")
    .select("total_points, current_streak_days, last_activity_date")
    .eq("user_id", userId)
    .single();

  const totalPoints = (existing?.total_points ?? 0) + pointsToAdd;
  let streak = existing?.current_streak_days ?? 0;
  const lastDate = existing?.last_activity_date;

  if (lastDate) {
    const diffDays = Math.floor(
      (new Date(today).getTime() - new Date(lastDate).getTime()) / 86_400_000
    );
    if (diffDays === 0) {
      // same day — streak unchanged
    } else if (diffDays === 1) {
      streak += 1;
    } else {
      streak = 1;
    }
  } else {
    streak = 1;
  }

  await supabase
    .from("points_and_streaks")
    .upsert(
      { user_id: userId, total_points: totalPoints, current_streak_days: streak, last_activity_date: today, level: levelFromPoints(totalPoints) },
      { onConflict: "user_id" }
    )
    .then();
}

async function getDashboardLink(userId: string): Promise<string | null> {
  const token =
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from("users")
    .update({ dashboard_token: token, token_expires_at: expiresAt })
    .eq("id", userId);

  if (error) {
    console.error("[dashboard-token] Error:", error);
    return null;
  }
  return `${DASHBOARD_URL}?token=${token}`;
}

const NAME_PATTERN = /(?:my name is|i'm|i am|call me)\s+([A-Z][a-z]+)/i;

type DataCapture = {
  full_name?: string;
  cv_full_name?: string;
  email?: string;
  job_title?: string;
  location_area?: string;
  skills?: string[];
  education_level?: string;
  education?: Education[];
  availability?: string;
  work_experience?: WorkExperience[];
  referee_contacts?: Referee[];
  awards?: string[];
  languages?: string[];
  interests?: string[];
  placement_confirmed?: boolean;
};

type EmployerCapture = {
  business_name?: string;
  location_area?: string;
  job_title?: string;
  job_description?: string;
  requirements?: string[];
  contact_name?: string;
  employment_type?: string;
  listing_free?: boolean;
  listing_confirmed?: boolean;
};

// DB check constraint allows: full-time | part-time | contract | casual | day-work | learnership
const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  // full-time
  "full-time": "full-time",
  "fulltime": "full-time",
  "full time": "full-time",
  "permanent": "full-time",
  // part-time
  "part-time": "part-time",
  "parttime": "part-time",
  "part time": "part-time",
  // contract
  "contract": "contract",
  "contractor": "contract",
  "fixed term": "contract",
  "fixed-term": "contract",
  // casual / temp
  "casual": "casual",
  "temp": "casual",
  "temporary": "casual",
  "temp/casual": "casual",
  "temp casual": "casual",
  // day work
  "day work": "day-work",
  "day-work": "day-work",
  "daywork": "day-work",
  "daily": "day-work",
  "per day": "day-work",
  // learnership
  "learnership": "learnership",
  "learner": "learnership",
  "apprenticeship": "learnership",
  "internship": "learnership",
  "graduate": "learnership",
};

function normaliseEmploymentType(raw: string | undefined): string | null {
  if (!raw) return null;
  return EMPLOYMENT_TYPE_MAP[raw.toLowerCase().trim()] ?? null;
}

function detectRequestedLanguage(message: string): Language | null {
  for (const [lang, pattern] of Object.entries(LANGUAGE_TRIGGERS) as [Language, RegExp][]) {
    if (pattern.test(message)) return lang;
  }
  return null;
}

function extractName(message: string): string | null {
  const match = message.match(NAME_PATTERN);
  return match ? match[1] : null;
}

function parseClaudeReply(raw: string): { message: string; data: DataCapture | null; employerData: EmployerCapture | null } {
  const separatorIndex = raw.lastIndexOf("|||");
  if (separatorIndex === -1) return { message: raw.trim(), data: null, employerData: null };

  const message = raw.slice(0, separatorIndex).trim();
  const jsonStr = raw.slice(separatorIndex + 3).trim();

  try {
    const parsed = JSON.parse(jsonStr);
    const data: DataCapture | null = parsed?.data_capture ?? null;
    const employerData: EmployerCapture | null = parsed?.employer_capture ?? null;
    return { message, data, employerData };
  } catch {
    return { message, data: null, employerData: null };
  }
}

async function saveProfileData(userId: string, data: DataCapture, existingFullName: string | null) {
  const userUpdates: Record<string, string> = {};
  const profileUpdates: Record<string, unknown> = {};

  // Users table: full_name, cv_full_name, email, location_area
  if (data.full_name?.trim() && !existingFullName) {
    userUpdates.full_name = data.full_name.trim();
  }
  if (data.cv_full_name?.trim()) userUpdates.cv_full_name = data.cv_full_name.trim();
  if (data.email?.trim()) userUpdates.email = data.email.trim();
  if (data.location_area?.trim()) userUpdates.location_area = data.location_area.trim();

  // user_profiles table
  if (data.job_title?.trim()) profileUpdates.job_title = data.job_title.trim();
  if (data.education_level?.trim()) profileUpdates.education_level = data.education_level.trim();
  if (data.education?.length) profileUpdates.education = data.education;
  if (data.availability?.trim()) profileUpdates.availability = data.availability.trim();
  if (data.skills?.length) profileUpdates.skills = data.skills;
  if (data.work_experience?.length) {
    const { data: existing } = await supabase
      .from("user_profiles")
      .select("work_experience")
      .eq("user_id", userId)
      .single();

    const existingExp: WorkExperience[] = existing?.work_experience ?? [];
    const merged = [...existingExp];
    for (const newEntry of data.work_experience) {
      const exists = merged.some(
        (e) => e.company?.toLowerCase() === newEntry.company?.toLowerCase()
      );
      if (!exists && newEntry.company) merged.push(newEntry);
    }
    profileUpdates.work_experience = merged;
  }
  if (data.referee_contacts?.length) profileUpdates.references = data.referee_contacts;
  if (data.awards?.length) profileUpdates.awards = data.awards;
  if (data.languages?.length) profileUpdates.languages_spoken = data.languages;
  if (data.interests?.length) profileUpdates.interests = data.interests;

  await Promise.all([
    Object.keys(userUpdates).length > 0
      ? supabase.from("users").update(userUpdates).eq("id", userId).then()
      : null,
    Object.keys(profileUpdates).length > 0
      ? supabase
          .from("user_profiles")
          .upsert({ user_id: userId, ...profileUpdates }, { onConflict: "user_id" })
          .then()
      : null,
  ]);
}

async function saveEmployerListing(
  phoneNumber: string,
  employer: EmployerCapture
): Promise<{ id: string; isNew: boolean } | null> {
  console.log("[saveEmployerListing] called with:", JSON.stringify(employer));
  // Upsert employer record by contact_phone
  const { data: existingEmployer, error: lookupError } = await supabase
    .from("employers")
    .select("id, contact_email, contact_phone")
    .eq("contact_phone", phoneNumber)
    .single();

  console.log("[saveEmployerListing] employer lookup:", { existingEmployer, lookupError });

  let employerId: string;
  let contactEmail: string | null = null;
  let contactPhone: string | null = phoneNumber;

  if (existingEmployer) {
    employerId = existingEmployer.id;
    contactEmail = existingEmployer.contact_email ?? null;
    contactPhone = existingEmployer.contact_phone ?? phoneNumber;
    const { error: updateError } = await supabase.from("employers").update({
      ...(employer.business_name && { business_name: employer.business_name }),
      ...(employer.location_area && { location_area: employer.location_area }),
      ...(employer.contact_name && { contact_name: employer.contact_name }),
    }).eq("id", employerId);
    console.log("[saveEmployerListing] employer update error:", updateError);
  } else {
    const { data: newEmployer, error } = await supabase
      .from("employers")
      .insert({
        contact_phone: phoneNumber,
        business_name: employer.business_name ?? "Unknown",
        location_area: employer.location_area ?? null,
        contact_name: employer.contact_name ?? null,
        employer_type: "informal",
        free_listing_used: false,
        phone_verified: false,
        suspended: false,
      })
      .select("id")
      .single();

    console.log("[saveEmployerListing] employer insert:", { newEmployer, error });

    if (error || !newEmployer) {
      console.error("[saveEmployerListing] Failed to create employer:", error);
      return null;
    }
    employerId = newEmployer.id;
  }

  console.log("[saveEmployerListing] employerId:", employerId);

  // Write employer_id onto the user record so the dashboard can look up jobs
  // directly without relying on phone number format matching
  await supabase.from("users").update({ employer_id: employerId }).eq("phone_number", phoneNumber).then();

  const applicationUrl = contactEmail
    ? `mailto:${contactEmail}`
    : contactPhone
    ? `tel:${contactPhone}`
    : null;

  const employmentType = normaliseEmploymentType(employer.employment_type);
  console.log("[saveEmployerListing] employmentType:", employmentType, "from:", employer.employment_type);

  try {
    // Dedup: if a listing with the same title already exists for this employer,
    // enrich it with any new details rather than creating a duplicate.
    console.log("[saveEmployerListing] checking for existing job, title:", employer.job_title, "employerId:", employerId);
    const { data: existingJob, error: jobLookupError } = await supabase
      .from("jobs")
      .select("id")
      .eq("employer_id", employerId)
      .eq("title", employer.job_title!)
      .maybeSingle();

    console.log("[saveEmployerListing] existing job lookup:", { existingJob, jobLookupError });

    if (existingJob) {
      const updates: Record<string, unknown> = {};
      if (employer.job_description) updates.description = employer.job_description;
      if (employer.requirements?.length) updates.requirements = employer.requirements;
      if (employer.location_area) updates.location_area = employer.location_area;
      if (employmentType) updates.employment_type = employmentType;
      if (applicationUrl) updates.application_url = applicationUrl;

      if (Object.keys(updates).length > 0) {
        const { error: enrichError } = await supabase.from("jobs").update(updates).eq("id", existingJob.id);
        console.log("[saveEmployerListing] enrich error:", enrichError);
      }
      console.log("[employer] Enriched existing listing:", existingJob.id);
      return { id: existingJob.id, isNew: false };
    }

    // Create new job listing
    const insertPayload = {
      employer_id: employerId,
      title: employer.job_title!,
      description: employer.job_description ?? null,
      requirements: employer.requirements ?? [],
      location_area: employer.location_area ?? null,
      employment_type: employmentType,
      application_url: applicationUrl,
      active: true,
      verified: true,
      source: "informal",
    };
    console.log("[saveEmployerListing] attempting job insert:", JSON.stringify(insertPayload));

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert(insertPayload)
      .select("id")
      .single();

    console.log("[saveEmployerListing] job insert result:", { job, jobError });

    if (jobError || !job) {
      console.error("[saveEmployerListing] Failed to create job listing:", JSON.stringify(jobError));
      return null;
    }

    return { id: job.id, isNew: true };
  } catch (err) {
    console.error("[saveEmployerListing] Unexpected thrown error:", err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const from: string = (formData.get("From") as string) ?? "";
    const body: string = (formData.get("Body") as string) ?? "";

    if (!from || !body) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const phone_number = from.replace(/^whatsapp:/i, "");

    // 1. Look up or create user
    let { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("phone_number", phone_number)
      .single();

    if (!user) {
      const { data: newUser, error } = await supabase
        .from("users")
        .insert({ phone_number, status: "seeking", preferred_language: null, current_mode: null })
        .select()
        .single();

      if (error || !newUser) {
        console.error("Failed to create user:", error);
        return new NextResponse("Internal error", { status: 500 });
      }
      user = newUser;
    }

    // 2. Detect language and name from this message
    const requestedLanguage = detectRequestedLanguage(body);
    const updates: Record<string, string> = {};

    const languageSwitched =
      requestedLanguage && requestedLanguage !== user.preferred_language
        ? requestedLanguage
        : null;

    if (languageSwitched) updates.preferred_language = languageSwitched;

    const detectedName = extractName(body);
    if (detectedName && !user.full_name) updates.full_name = detectedName;

    if (Object.keys(updates).length > 0) {
      await supabase.from("users").update(updates).eq("id", user.id);
      user = { ...user, ...updates };
    }

    // 3. If no language chosen yet → send greeting
    if (!user.preferred_language) {
      await supabase.from("conversations").insert([
        { user_id: user.id, message_role: "user", message_content: body },
        { user_id: user.id, message_role: "assistant", message_content: LANGUAGE_GREETING },
      ]);
      await sendWhatsAppMessage(from, LANGUAGE_GREETING);
      return new NextResponse("OK", { status: 200 });
    }

    // 3b. If language set but mode not yet chosen → require explicit reply to prompt
    if (!user.current_mode) {
      const trimmedBody = body.trim();
      let modeFromMessage: "seeking" | "hiring" | null = null;
      // Only accept explicit responses to the mode prompt — broad phrase matching causes
      // the prompt to be skipped when the user's first message happens to contain "need a job" etc.
      if (/^\s*[13]\s*$/.test(trimmedBody) || /\bboth\b/i.test(trimmedBody)) {
        modeFromMessage = "seeking";
      } else if (/^\s*2\s*$/.test(trimmedBody)) {
        modeFromMessage = "hiring";
      }

      if (modeFromMessage) {
        await supabase.from("users").update({ current_mode: modeFromMessage }).eq("id", user.id);
        user = { ...user, current_mode: modeFromMessage as "seeking" | "hiring" };
      } else {
        await supabase.from("conversations").insert([
          { user_id: user.id, message_role: "user", message_content: body },
          { user_id: user.id, message_role: "assistant", message_content: MODE_PROMPT },
        ]);
        await sendWhatsAppMessage(from, MODE_PROMPT);
        return new NextResponse("OK", { status: 200 });
      }
    }

    // 4. Handle CV generation request
    if (CV_REQUEST.test(body)) {
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("user_id", user.id)
        .single();

      try {
        // Always generate fresh — never reuse a cached cv_url
        const pdfBuffer = await generateCV(user, profile ?? {
          user_id: user.id,
          job_title: null,
          education_level: null,
          education: null,
          skills: null,
          work_experience: null,
          availability: null,
          awards: null,
          languages_spoken: null,
          interests: null,
          references: null,
          cv_generated: null,
          cv_url: null,
          profile_complete: null,
          profile_score: null,
          last_job_matches: null,
        });

        const filename = `${user.id}-${Date.now()}.pdf`;

        // upsert: true overwrites any existing file for this user
        await supabase.storage.from("cvs").upload(filename, pdfBuffer, {
          contentType: "application/pdf",
          upsert: true,
        });

        const { data: { publicUrl } } = supabase.storage.from("cvs").getPublicUrl(filename);

        await supabase
          .from("user_profiles")
          .upsert({ user_id: user.id, cv_url: publicUrl, cv_generated: true }, { onConflict: "user_id" });

        const cvMessage = `Your CV is ready — download it here: ${publicUrl}`;
        await sendWhatsAppMessage(from, cvMessage);

        // Send dashboard link (fire and forget — CV message arrives first)
        getDashboardLink(user.id).then(async (link) => {
          if (!link) return;
          const dashMsg = `Your MainGig profile is ready — view your CV and job matches here: ${link}`;
          await sendWhatsAppMessage(from, dashMsg).catch(() => {});
          await supabase.from("conversations").insert({
            user_id: user.id, message_role: "assistant", message_content: dashMsg,
          }).then();
        }).catch(() => {});

        await supabase.from("conversations").insert([
          { user_id: user.id, message_role: "user", message_content: body },
          { user_id: user.id, message_role: "assistant", message_content: cvMessage },
        ]);

        return new NextResponse("OK", { status: 200 });
      } catch (cvErr) {
        console.error("CV generation error:", cvErr);
        const errMessage = "Sorry, I had trouble generating your CV just now. Try again in a moment.";
        await sendWhatsAppMessage(from, errMessage);
        return new NextResponse("OK", { status: 200 });
      }
    }

    // 4. Load conversation history and user profile in parallel
    const [{ data: history }, { data: userProfile }] = await Promise.all([
      supabase
        .from("conversations")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("user_profiles")
        .select("job_title, education_level, skills, work_experience, availability, awards, languages_spoken, interests")
        .eq("user_id", user.id)
        .single(),
    ]);

    const orderedHistory: Message[] = (history ?? []).reverse();
    const hasSpokenBefore = (history ?? []).some((m) => m.message_role === "assistant");
    console.log("[profile] userProfile loaded:", userProfile ? JSON.stringify(Object.keys(userProfile)) : "null");

    // 5. Derive mode from user record; intent classification can update it this turn
    let isEmployerMode = user.current_mode === "hiring";
    let jobMatches: JobMatch[] = [];
    let dashboardLink: string | undefined;
    let wantsJobs = false;
    let wantsToApply = false;
    // Cached to avoid generating two tokens when wantsJobs and wantsDashboard are both true
    let sharedLink: string | null | undefined = undefined;

    // 5b. Intent classification — skip in employer mode (Sisi handles that flow via system prompt)
    if (!isEmployerMode) try {
      const intentResponse = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 40,
        messages: [{
          role: "user",
          content: `Classify this WhatsApp message into four categories. Answer YES or NO for each, separated by spaces.

1. JOB SEEKER — is this person looking for a job to apply to?
Examples: "find me work" "any jobs" "I need a job" "looking for work" "any vacancies"

2. DASHBOARD — are they asking to see their profile, CV, or dashboard link?
Examples: "show my profile" "my dashboard" "see my cv" "send me my profile link"

3. EMPLOYER — is this person an employer wanting to hire someone or post a job?
Examples: "I want to hire" "I need staff" "post a job" "I have a vacancy" "I need a domestic worker" "I need a driver" "I need a cleaner" "I am looking for a worker" "I need someone to work for me" "I want to find an employee" "I need to fill a position" "I want to recruit"

4. APPLYING — is this person saying they want to apply for a specific job, asking how to apply, or saying they have applied?
Examples: "I want to apply" "how do I apply" "I'm applying" "applying now" "I applied" "send them my CV" "I'll apply for that one"

Message: "${body}"

Reply with exactly four words in this order: [1] [2] [3] [4]`,
        }],
      });

      const intentText = intentResponse.content[0].type === "text"
        ? intentResponse.content[0].text.trim().toUpperCase()
        : "";
      // Split on whitespace or slash to handle both "YES NO YES NO" and "YES/NO/YES/NO" formats
      const intentParts = intentText.split(/[\s/]+/);

      wantsJobs = intentParts[0]?.startsWith("YES") ?? false;
      const wantsDashboard = intentParts[1]?.startsWith("YES") ?? false;
      const wantsToHire = intentParts[2]?.startsWith("YES") ?? false;
      wantsToApply = intentParts[3]?.startsWith("YES") ?? false;

      console.log("[intent] raw:", intentText, "| wantsJobs:", wantsJobs, "wantsDashboard:", wantsDashboard, "wantsToHire:", wantsToHire, "wantsToApply:", wantsToApply);

      // Update mode only if already set — mode prompt owns the initial assignment
      if (wantsToHire && user.current_mode !== null && user.current_mode !== "hiring") {
        supabase.from("users").update({ current_mode: "hiring" }).eq("id", user.id).then();
        user = { ...user, current_mode: "hiring" };
        isEmployerMode = true;
      }

      if (wantsJobs && user.current_mode === "hiring") {
        // Only switch from hiring → seeking, never set from null
        supabase.from("users").update({ current_mode: "seeking" }).eq("id", user.id).then();
        user = { ...user, current_mode: "seeking" };
        isEmployerMode = false;
      }

      if (wantsDashboard) {
        sharedLink = await getDashboardLink(user.id);
        if (sharedLink) dashboardLink = sharedLink;
      }

      if (wantsJobs && !isEmployerMode) {
        if (userProfile) {
          jobMatches = await matchJobs(
            userProfile as Parameters<typeof matchJobs>[0],
            user.location_area ?? null,
            body
          ).catch((err) => {
            console.error("[job-matcher] Error:", err);
            return [];
          });

          console.log("[job-matcher] wantsJobs matches found:", jobMatches.length);

          if (jobMatches.length) {
            supabase
              .from("user_profiles")
              .upsert({ user_id: user.id, last_job_matches: jobMatches }, { onConflict: "user_id" })
              .then();

            // Reuse already-generated token or create one now — never overwrite with a second token
            (sharedLink !== undefined
              ? Promise.resolve(sharedLink)
              : getDashboardLink(user.id).then((l) => { sharedLink = l; return l; })
            ).then((link) => {
              if (!link) return;
              setTimeout(() => {
                sendWhatsAppMessage(from, `See your matches on your dashboard: ${link}`).catch(() => {});
              }, 3000);
            }).catch(() => {});
          }
        }
      }
    } catch (intentErr) {
      // On error: log and fall through — callClaude below still runs with full context,
      // so Sisi handles the message naturally without any intent-driven enhancements.
      console.error("[intent] Classification error:", intentErr);
    }

    // Auto-trigger: when profile is rich enough, run matcher and pass results to Sisi.
    // Only fires when wantsJobs intent was not already detected.
    if (!wantsJobs && !isEmployerMode && jobMatches.length === 0 && userProfile) {
      const profileRich =
        ((userProfile.skills?.length ?? 0) > 0 || (userProfile.work_experience?.length ?? 0) > 0) &&
        user.location_area;

      console.log("[job-matcher] auto-trigger check — profileRich:", !!profileRich);

      if (profileRich) {
        const autoMatches = await matchJobs(
          userProfile as Parameters<typeof matchJobs>[0],
          user.location_area ?? null,
          body
        ).catch((err) => {
          console.error("[job-matcher] auto-trigger error:", err);
          return [];
        });

        console.log("[job-matcher] auto-trigger matches:", autoMatches.length);

        if (autoMatches.length) {
          jobMatches = autoMatches;
          supabase
            .from("user_profiles")
            .upsert({ user_id: user.id, last_job_matches: autoMatches }, { onConflict: "user_id" })
            .then();
        }
      }
    }

    // 5c. Increment view_count on matched jobs (fire and forget analytics)
    if (jobMatches.length) {
      for (const match of jobMatches) {
        if (match.id) {
          supabase.from("jobs").select("view_count").eq("id", match.id).single()
            .then(({ data }) => {
              supabase.from("jobs")
                .update({ view_count: (data?.view_count ?? 0) + 1 })
                .eq("id", match.id)
                .then();
            });
        }
      }
    }

    // 5d. Handle application intent — increment count and notify employer
    if (wantsToApply && !isEmployerMode) {
      try {
        const { data: savedProfile } = await supabase
          .from("user_profiles")
          .select("last_job_matches")
          .eq("user_id", user.id)
          .single();

        const lastMatches = (savedProfile?.last_job_matches ?? []) as Array<JobMatch & { id?: string }>;
        const topJob = lastMatches[0];

        if (topJob?.id) {
          const { data: jobData } = await supabase
            .from("jobs")
            .select("id, title, location_area, application_count, employers(contact_phone, contact_name)")
            .eq("id", topJob.id)
            .single();

          if (jobData) {
            supabase.from("jobs")
              .update({ application_count: ((jobData.application_count as number | null) ?? 0) + 1 })
              .eq("id", topJob.id)
              .then();

            const employer = (Array.isArray(jobData.employers) ? jobData.employers[0] : jobData.employers) as { contact_phone: string | null; contact_name: string | null } | null;
            if (employer?.contact_phone) {
              const contactName = employer.contact_name ?? "there";
              const loc = (jobData.location_area as string | null) ?? "Cape Town";
              const waMsg = `Hi ${contactName}, someone just applied for your ${jobData.title} listing in ${loc}. They'll be in touch with you directly.`;
              const toNumber = employer.contact_phone.startsWith("whatsapp:")
                ? employer.contact_phone
                : `whatsapp:${employer.contact_phone}`;
              sendWhatsAppMessage(toNumber, waMsg).catch((err) =>
                console.error("[apply] Employer notification error:", err)
              );
            }
          }
        }
      } catch (err) {
        console.error("[apply] Error handling application:", err);
      }
    }

    // 6. Call Claude
    let rawReply: string;
    try {
      rawReply = await callClaude(orderedHistory, body, {
        full_name: user.full_name ?? null,
        preferred_language: user.preferred_language as Language,
        hasSpokenBefore,
        languageSwitched,
        jobMatches: jobMatches.length ? jobMatches : undefined,
        dashboardLink,
        current_mode: user.current_mode as "seeking" | "hiring",
        location_area: user.location_area ?? null,
        profile: userProfile ?? null,
      });
    } catch (claudeErr) {
      console.error("[claude] callClaude failed (possible timeout):", claudeErr);
      const fallback = "Sorry, I'm having a moment. Send me that again?";
      await sendWhatsAppMessage(from, fallback).catch(() => {});
      await supabase.from("conversations").insert([
        { user_id: user.id, message_role: "user", message_content: body },
        { user_id: user.id, message_role: "assistant", message_content: fallback },
      ]);
      return new NextResponse("OK", { status: 200 });
    }

    console.log("[1] Raw Claude reply:", rawReply);

    // 7. Strip data capture block from reply
    const { message, data, employerData } = parseClaudeReply(rawReply);

    console.log("[2] Cleaned message after parseClaudeReply:", message);

    // 8. Save profile data captured in this turn (fire and forget — don't block response)
    if (data) {
      saveProfileData(user.id, data, user.full_name ?? null).catch((err) =>
        console.error("Profile save error:", err)
      );

      // If Sisi confirmed a placement, record it and update user status
      if (data.placement_confirmed === true) {
        const placedAt = new Date().toISOString();
        supabase
          .from("users")
          .update({ status: "placed" })
          .eq("id", user.id)
          .then();
        supabase
          .from("placements")
          .insert({ user_id: user.id, placed_at: placedAt })
          .then((res) => {
            if (res.error) console.error("[placement] Insert error:", res.error);
            else console.log("[placement] Recorded for user:", user.id);
          });
      }
    }

    // 8b. Save employer listing only after employer replies YES to confirm the summary
    console.log("[employer] employerData:", JSON.stringify(employerData));
    console.log("[employer] listing_confirmed:", employerData?.listing_confirmed);
    if (employerData?.business_name && employerData?.job_title && employerData?.listing_confirmed === true) {
      console.log("[employer] calling saveEmployerListing...");
      try {
        const result = await saveEmployerListing(phone_number, employerData);
        console.log("[employer] saveEmployerListing result:", JSON.stringify(result));
        if (result) {
          console.log(`[employer] Listing ${result.isNew ? "created" : "enriched"}:`, result.id);
          if (result.isNew) {
            const link = await getDashboardLink(user.id);
            if (link) {
              const dashMsg = `Your listing is live on MainGig. View and manage it here: ${link}`;
              await sendWhatsAppMessage(from, dashMsg).catch(() => {});
              await supabase.from("conversations").insert({
                user_id: user.id, message_role: "assistant", message_content: dashMsg,
              }).then();
            }
          }
        }
      } catch (err) {
        console.error("[employer] Save error:", err);
      }
    }

    // 9. Persist conversation (store clean message, not the raw reply with JSON)
    await supabase.from("conversations").insert([
      { user_id: user.id, message_role: "user", message_content: body },
      { user_id: user.id, message_role: "assistant", message_content: message },
    ]);

    // 10. Award points, update streak and last_active (fire and forget)
    updatePointsAndStreaks(user.id, 5).catch((err) => console.error("[points] Error:", err));
    supabase.from("users").update({ last_active: new Date().toISOString() }).eq("id", user.id).then();

    // 11. Send clean message to user
    console.log("[3] Sending to WhatsApp:", { to: from, message });
    try {
      const result = await sendWhatsAppMessage(from, message);
      console.log("[4] WhatsApp send success:", result.sid);
    } catch (twilioErr) {
      console.error("[4] WhatsApp send error:", twilioErr);
      throw twilioErr;
    }

    return new NextResponse("OK", { status: 200 });
  } catch (err) {
    console.error("Webhook error:", err);
    return new NextResponse("Internal error", { status: 500 });
  }
}
