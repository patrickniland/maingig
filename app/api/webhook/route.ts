import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { callClaude } from "@/lib/claude";
import { sendWhatsAppMessage } from "@/lib/twilio";
import type { Message } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const from: string = (formData.get("From") as string) ?? "";
    const body: string = (formData.get("Body") as string) ?? "";

    if (!from || !body) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Normalise to E.164 phone number (strip whatsapp: prefix if present)
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
        .insert({ phone_number, status: "seeking" })
        .select()
        .single();

      if (error || !newUser) {
        console.error("Failed to create user:", error);
        return new NextResponse("Internal error", { status: 500 });
      }
      user = newUser;
    }

    // 2. Load last 20 messages for conversation history
    const { data: history } = await supabase
      .from("conversations")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    const orderedHistory: Message[] = (history ?? []).reverse();

    // 3. Call Claude with Sisi prompt + history
    const reply = await callClaude(orderedHistory, body);

    // 4. Persist both messages
    await supabase.from("conversations").insert([
      { user_id: user.id, message_role: "user", message_content: body },
      { user_id: user.id, message_role: "assistant", message_content: reply },
    ]);

    // 5. Send reply via Twilio
    await sendWhatsAppMessage(from, reply);

    return new NextResponse("OK", { status: 200 });
  } catch (err) {
    console.error("Webhook error:", err);
    return new NextResponse("Internal error", { status: 500 });
  }
}
