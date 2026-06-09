import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { callClaude } from "@/lib/claude";
import { sendWhatsAppMessage } from "@/lib/twilio";
import type { Message, Language } from "@/lib/supabase";

const LANGUAGE_GREETING =
  "Molo / Hello! I'm Sisi, your job coach. Which language would you like to chat in?\nReply: English, Xhosa, Zulu or Afrikaans.";

const LANGUAGE_TRIGGERS: Record<Language, RegExp> = {
  english:   /\b(english|english please|switch to english)\b/i,
  xhosa:     /\b(xhosa|isixhosa)\b/i,
  zulu:      /\b(zulu|isizulu|zulu please)\b/i,
  afrikaans: /\b(afrikaans|afrikaans please)\b/i,
};

// Detects "my name is X", "I'm X", "I am X", "call me X"
const NAME_PATTERN = /(?:my name is|i'm|i am|call me)\s+([A-Z][a-z]+)/i;

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

    if (languageSwitched) {
      updates.preferred_language = languageSwitched;
    }

    const detectedName = extractName(body);
    if (detectedName && !user.full_name) {
      updates.full_name = detectedName;
    }

    if (Object.keys(updates).length > 0) {
      await supabase.from("users").update(updates).eq("id", user.id);
      user = { ...user, ...updates };
    }

    // 3. If no language chosen yet and none detected in this message → send greeting
    if (!user.preferred_language) {
      await supabase.from("conversations").insert([
        { user_id: user.id, message_role: "user", message_content: body },
        { user_id: user.id, message_role: "assistant", message_content: LANGUAGE_GREETING },
      ]);
      await sendWhatsAppMessage(from, LANGUAGE_GREETING);
      return new NextResponse("OK", { status: 200 });
    }

    // 4. Load last 20 messages
    const { data: history } = await supabase
      .from("conversations")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    const orderedHistory: Message[] = (history ?? []).reverse();

    // 5. Call Claude with full user context
    const reply = await callClaude(orderedHistory, body, {
      full_name: user.full_name ?? null,
      preferred_language: user.preferred_language as Language,
      isReturning,
      isFirstLanguageSelection: !isReturning && !!languageSwitched,
      languageSwitched: isReturning ? languageSwitched : null,
    });

    // 6. Persist both messages
    await supabase.from("conversations").insert([
      { user_id: user.id, message_role: "user", message_content: body },
      { user_id: user.id, message_role: "assistant", message_content: reply },
    ]);

    // 7. Send reply via Twilio
    await sendWhatsAppMessage(from, reply);

    return new NextResponse("OK", { status: 200 });
  } catch (err) {
    console.error("Webhook error:", err);
    return new NextResponse("Internal error", { status: 500 });
  }
}
