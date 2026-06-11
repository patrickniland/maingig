import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendWhatsAppMessage } from "@/lib/twilio";

export async function GET(req: NextRequest) {
  // Vercel sends CRON_SECRET as a Bearer token; fall back to DASHBOARD_SECRET_TOKEN
  const auth = req.headers.get("authorization")?.replace("Bearer ", "");
  if (
    auth !== process.env.CRON_SECRET &&
    auth !== process.env.DASHBOARD_SECRET_TOKEN
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();

  const { data: users, error } = await supabase
    .from("users")
    .select("id, phone_number, full_name, preferred_language")
    .eq("status", "seeking")
    .or(`last_active.is.null,last_active.lt.${cutoff}`);

  if (error) {
    console.error("[cron/checkin] Query error:", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  if (!users?.length) {
    return NextResponse.json({ sent: 0 });
  }

  let sent = 0;
  const now = new Date().toISOString();

  for (const user of users) {
    const name = user.full_name ? user.full_name.split(" ")[0] : "there";
    const message = `Hey ${name}! How's the job hunt going today? Any applications sent or interviews coming up?`;
    const to = `whatsapp:${user.phone_number}`;

    try {
      await sendWhatsAppMessage(to, message);

      await supabase.from("conversations").insert({
        user_id: user.id,
        message_role: "assistant",
        message_content: message,
      });

      await supabase.from("users").update({ last_active: now }).eq("id", user.id);

      sent++;
    } catch (err) {
      console.error(`[cron/checkin] Failed to message ${user.phone_number}:`, err);
    }
  }

  return NextResponse.json({ sent, total: users.length });
}
