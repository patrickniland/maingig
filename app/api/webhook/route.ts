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

function parseClaudeReply(raw: string): { message: string; data: DataCapture | null } {
  const separatorIndex = raw.lastIndexOf("|||");
  if (separatorIndex === -1) return { message: raw.trim(), data: null };

  const message = raw.slice(0, separatorIndex).trim();
  const jsonStr = raw.slice(separatorIndex + 3).trim();

  try {
    const parsed = JSON.parse(jsonStr);
    const data: DataCapture = parsed?.data_capture ?? {};
    return { message, data };
  } catch {
    return { message, data: null };
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
  if (data.work_experience?.length) profileUpdates.work_experience = data.work_experience;
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

        // Also send the dashboard link (fire and forget so CV message arrives first)
        getDashboardLink(user.id).then(async (link) => {
          if (!link) return;
          const dashMsg = `Your MainGig dashboard is ready — see your profile, CV and job matches here: ${link}`;
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

    // 5. Intent classification — run job and dashboard intent calls in parallel
    let jobMatches: JobMatch[] = [];
    try {
      const recentContext = orderedHistory.slice(-2).map(m => m.message_content).join(" ");

      const [jobsIntent, dashIntent] = await Promise.all([
        anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 10,
          messages: [{ role: "user", content: `Does this message express interest in finding a job, seeing job listings, or getting work? Answer only YES or NO.\n\nMessage: "${body}"\n\nRecent context: "${recentContext}"` }],
        }),
        anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 10,
          messages: [{ role: "user", content: `Does this message ask to see a dashboard, profile page, or personal page? Answer only YES or NO.\n\nMessage: "${body}"` }],
        }),
      ]);

      const wantsJobs =
        jobsIntent.content[0].type === "text" &&
        jobsIntent.content[0].text.trim().toUpperCase().startsWith("YES");

      const wantsDashboard =
        dashIntent.content[0].type === "text" &&
        dashIntent.content[0].text.trim().toUpperCase().startsWith("YES");

      console.log("[intent] wantsJobs:", wantsJobs, "wantsDashboard:", wantsDashboard);

      if (wantsDashboard) {
        const link = await getDashboardLink(user.id);
        if (link) {
          const dashMsg = `Your MainGig dashboard is ready — see your profile, CV and job matches here: ${link}`;
          await supabase.from("conversations").insert([
            { user_id: user.id, message_role: "user", message_content: body },
            { user_id: user.id, message_role: "assistant", message_content: dashMsg },
          ]);
          await sendWhatsAppMessage(from, dashMsg);
          return new NextResponse("OK", { status: 200 });
        }
      }

      if (wantsJobs) {
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

          // Persist matches so the dashboard can display them
          if (jobMatches.length) {
            supabase
              .from("user_profiles")
              .update({ last_job_matches: jobMatches })
              .eq("user_id", user.id)
              .then();
          }
        }
      }
    } catch (intentErr) {
      console.error("[intent] Classification error:", intentErr);
    }

    // 6. Call Claude
    const rawReply = await callClaude(orderedHistory, body, {
      full_name: user.full_name ?? null,
      preferred_language: user.preferred_language as Language,
      isReturning,
      isFirstLanguageSelection: !isReturning && !!languageSwitched,
      languageSwitched: isReturning ? languageSwitched : null,
      jobMatches: jobMatches.length ? jobMatches : undefined,
    });

    console.log("[1] Raw Claude reply:", rawReply);

    // 7. Strip data capture block from reply
    const { message, data } = parseClaudeReply(rawReply);

    console.log("[2] Cleaned message after parseClaudeReply:", message);

    // 8. Save profile data captured in this turn (fire and forget — don't block response)
    if (data) {
      saveProfileData(user.id, data, user.full_name ?? null).catch((err) =>
        console.error("Profile save error:", err)
      );
    }

    // 9. Persist conversation (store clean message, not the raw reply with JSON)
    await supabase.from("conversations").insert([
      { user_id: user.id, message_role: "user", message_content: body },
      { user_id: user.id, message_role: "assistant", message_content: message },
    ]);

    // 10. Send clean message to user
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
