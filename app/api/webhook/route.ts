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
  const { data, error } = await supabase.rpc("generate_dashboard_token", { user_id: userId });
  if (error || !data) {
    console.error("[dashboard-token] Error:", error);
    return null;
  }
  return `${DASHBOARD_URL}?token=${data as string}`;
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
};

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

async function saveEmployerListing(phoneNumber: string, employer: EmployerCapture): Promise<string | null> {
  // Upsert employer record by contact_phone
  const { data: existingEmployer } = await supabase
    .from("employers")
    .select("id")
    .eq("contact_phone", phoneNumber)
    .single();

  let employerId: string;

  if (existingEmployer) {
    employerId = existingEmployer.id;
    if (employer.business_name || employer.location_area || employer.contact_name) {
      await supabase.from("employers").update({
        ...(employer.business_name && { business_name: employer.business_name }),
        ...(employer.location_area && { location_area: employer.location_area }),
        ...(employer.contact_name && { contact_name: employer.contact_name }),
      }).eq("id", employerId);
    }
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

    if (error || !newEmployer) {
      console.error("[employer] Failed to create employer:", error);
      return null;
    }
    employerId = newEmployer.id;
  }

  // Create job listing
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({
      employer_id: employerId,
      title: employer.job_title!,
      description: employer.job_description ?? null,
      requirements: employer.requirements ?? [],
      location_area: employer.location_area ?? null,
      employment_type: employer.employment_type ?? null,
      active: true,
      verified: true,
      source: "informal",
    })
    .select("id")
    .single();

  if (jobError || !job) {
    console.error("[employer] Failed to create job listing:", jobError);
    return null;
  }

  // Mark listing as used so employer is no longer in onboarding mode
  await supabase
    .from("employers")
    .update({ free_listing_used: true })
    .eq("id", employerId);

  return job.id;
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

    const isReturning = !!user;

    if (!user) {
      const { data: newUser, error } = await supabase
        .from("users")
        .insert({ phone_number, status: "seeking", preferred_language: null })
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

    // 4. Load last 20 messages
    const { data: history } = await supabase
      .from("conversations")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    const orderedHistory: Message[] = (history ?? []).reverse();

    // 5. Check employers table to detect active onboarding (free_listing_used = false means mid-flow)
    const { data: existingEmployerCheck } = await supabase
      .from("employers")
      .select("id, free_listing_used")
      .eq("contact_phone", phone_number)
      .single();

    let isEmployerMode = !!existingEmployerCheck && !existingEmployerCheck.free_listing_used;

    let jobMatches: JobMatch[] = [];
    let dashboardLink: string | undefined;

    if (isEmployerMode) {
      // Already mid employer onboarding — skip intent classification entirely
      console.log("[intent] Skipping classification — already in employer mode");
    } else {
      // 5b. Intent classification
      try {
        const intentResponse = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 20,
          messages: [{
            role: "user",
            content: `Classify this message with YES or NO for each:\n1. Is the person looking for a JOB to apply for, or asking to see job listings?\n2. Is the person asking to see their personal DASHBOARD, profile page, or CV page?\n3. Is the person wanting to POST a job, HIRE someone, or FIND STAFF for their business?\n\nMessage: "${body}"\n\nAnswer with exactly: YES/NO YES/NO YES/NO\nOnly answer YES if you are certain. When in doubt answer NO.`,
          }],
        });

        const intentText = intentResponse.content[0].type === "text"
          ? intentResponse.content[0].text.trim().toUpperCase()
          : "";
        const intentParts = intentText.split(/\s+/);

        const wantsJobs = intentParts[0]?.startsWith("YES") ?? false;
        const wantsDashboard = intentParts[1]?.startsWith("YES") ?? false;
        const wantsToHire = intentParts[2]?.startsWith("YES") ?? false;

        console.log("[intent] raw:", intentText, "| wantsJobs:", wantsJobs, "wantsDashboard:", wantsDashboard, "wantsToHire:", wantsToHire);

        if (wantsDashboard) {
          const link = await getDashboardLink(user.id);
          if (link) dashboardLink = link;
        }

        if (wantsToHire) {
          const { data: existingEmployer } = await supabase
            .from("employers")
            .select("id")
            .eq("contact_phone", phone_number)
            .single();

          isEmployerMode = true;
          console.log("[intent] Entering employer mode — existing:", !!existingEmployer);
        }

        if (wantsJobs && !isEmployerMode) {
          const { data: profile } = await supabase
            .from("user_profiles")
            .select("*")
            .eq("user_id", user.id)
            .single();

          if (profile) {
            jobMatches = await matchJobs(profile, user.location_area ?? null, body).catch((err) => {
              console.error("[job-matcher] Error:", err);
              return [];
            });

            if (jobMatches.length) {
              supabase
                .from("user_profiles")
                .upsert({ user_id: user.id, last_job_matches: jobMatches }, { onConflict: "user_id" })
                .then();

              getDashboardLink(user.id).then((link) => {
                if (!link) return;
                setTimeout(() => {
                  sendWhatsAppMessage(from, `See your matches on your dashboard: ${link}`).catch(() => {});
                }, 3000);
              }).catch(() => {});
            }
          }
        }
      } catch (intentErr) {
        console.error("[intent] Classification error:", intentErr);
      }
    }

    // 6. Call Claude
    const rawReply = await callClaude(orderedHistory, body, {
      full_name: user.full_name ?? null,
      preferred_language: user.preferred_language as Language,
      isReturning,
      isFirstLanguageSelection: !isReturning && !!languageSwitched,
      languageSwitched: isReturning ? languageSwitched : null,
      jobMatches: jobMatches.length ? jobMatches : undefined,
      dashboardLink,
      isEmployerMode,
    });

    console.log("[1] Raw Claude reply:", rawReply);

    // 7. Strip data capture block from reply
    const { message, data, employerData } = parseClaudeReply(rawReply);

    console.log("[2] Cleaned message after parseClaudeReply:", message);

    // 8. Save profile data captured in this turn (fire and forget — don't block response)
    if (data) {
      saveProfileData(user.id, data, user.full_name ?? null).catch((err) =>
        console.error("Profile save error:", err)
      );
    }

    // 8b. Save employer listing when capture is complete
    if (employerData?.business_name && employerData?.job_title) {
      saveEmployerListing(phone_number, employerData).then((jobId) => {
        if (!jobId) return;
        console.log("[employer] Job listing created:", jobId);
      }).catch((err) => console.error("[employer] Save error:", err));
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
