import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { callClaude } from "@/lib/claude";
import { sendWhatsAppMessage } from "@/lib/twilio";
import type { Message } from "@/lib/supabase";

const XHOSA_TRIGGER = /\b(xhosa|isixhosa)\b/i;
const ENGLISH_TRIGGER = /\b(english|switch to english|english please)\b/i;

// Detects "my name is X", "I'm X", "I am X", "call me X" — captures first capitalised word after the pattern
const NAME_PATTERN = /(?:my name is|i'm|i am|call me)\s+([A-Z][a-z]+)/i;

function detectRequestedLanguage(message: string): "xhosa" | "english" | null {
  if (XHOSA_TRIGGER.test(message)) return "xhosa";
  if (ENGLISH_TRIGGER.test(message)) return "english";
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
        .insert({ phone_number, status: "seeking", preferred_language: "english" })
        .select()
        .single();

      if (error || !newUser) {
        console.error("Failed to create user:", error);
        return new NextResponse("Internal error", { status: 500 });
      }
      user = newUser;
    }

    // 2. Detect language switch and name from this message
    const updates: Record<string, string> = {};

    const requestedLanguage = detectRequestedLanguage(body);
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

    // 3. Load last 20 messages
    const { data: history } = await supabase
      .from("conversations")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    const orderedHistory: Message[] = (history ?? []).reverse();

    // 4. Call Claude with full user context
    const reply = await callClaude(orderedHistory, body, {
      full_name: user.full_name ?? null,
      preferred_language: user.preferred_language ?? "english",
      isReturning,
      languageSwitched,
    });

    // 5. Persist both messages
    await supabase.from("conversations").insert([
      { user_id: user.id, message_role: "user", message_content: body },
      { user_id: user.id, message_role: "assistant", message_content: reply },
    ]);

    // 6. Send reply via Twilio
    await sendWhatsAppMessage(from, reply);

    return new NextResponse("OK", { status: 200 });
  } catch (err) {
    console.error("Webhook error:", err);
    return new NextResponse("Internal error", { status: 500 });
  }
}
