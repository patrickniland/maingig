import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendWhatsAppMessage } from "@/lib/twilio";

type PlacementRow = {
  id: string;
  user_id: string;
  placed_at: string;
  day_30: boolean | null;
  day_60: boolean | null;
  day_90: boolean | null;
  users: {
    phone_number: string;
    full_name: string | null;
  } | null;
};

type CheckinConfig = {
  label: string;
  minHours: number;
  maxHours: number;
  flag: "day_30" | "day_60" | "day_90" | null;
  message: (name: string) => string;
};

const CHECKINS: CheckinConfig[] = [
  {
    label: "day-1",
    minHours: 20,
    maxHours: 28,
    flag: null,
    message: (name) =>
      `Hey ${name}! How was your first day? I want to hear everything. Even the small stuff — first days can be a lot.`,
  },
  {
    label: "week-1",
    minHours: 7 * 24 - 4,
    maxHours: 7 * 24 + 4,
    flag: null,
    message: (name) =>
      `Hey ${name}! First week done — that's real progress. How's it feeling so far? Anything you're finding tough or anything that's going well?`,
  },
  {
    label: "month-1",
    minHours: 30 * 24 - 12,
    maxHours: 30 * 24 + 12,
    flag: "day_30",
    message: (name) =>
      `Hey ${name}! One month in your new role — that's a big deal. How's it going? Are you settling in okay?`,
  },
  {
    label: "month-3",
    minHours: 90 * 24 - 12,
    maxHours: 90 * 24 + 12,
    flag: "day_90",
    message: (name) =>
      `Hey ${name}! Three months already! How are things going at work? We'd love to know how you're getting on.`,
  },
];

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization")?.replace("Bearer ", "");
  if (
    auth !== process.env.CRON_SECRET &&
    auth !== process.env.DASHBOARD_SECRET_TOKEN
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  let sent = 0;
  const results: Record<string, number> = {};

  for (const checkin of CHECKINS) {
    const minAgo = new Date(now - checkin.maxHours * 3_600_000).toISOString();
    const maxAgo = new Date(now - checkin.minHours * 3_600_000).toISOString();

    let query = supabase
      .from("placements")
      .select("id, user_id, placed_at, day_30, day_60, day_90, users(phone_number, full_name)")
      .gte("placed_at", minAgo)
      .lte("placed_at", maxAgo);

    // For flagged check-ins, only send if flag is not yet set
    if (checkin.flag) {
      query = query.is(checkin.flag, null);
    }

    const { data: placements, error } = await query;

    if (error) {
      console.error(`[placement-checkin/${checkin.label}] Query error:`, error);
      continue;
    }

    let labelSent = 0;

    for (const row of (placements ?? []) as unknown as PlacementRow[]) {
      const user = row.users;
      if (!user?.phone_number) continue;

      const name = user.full_name ? user.full_name.split(" ")[0] : "there";
      const message = checkin.message(name);
      const to = `whatsapp:${user.phone_number}`;

      try {
        await sendWhatsAppMessage(to, message);

        await supabase.from("conversations").insert({
          user_id: row.user_id,
          message_role: "assistant",
          message_content: message,
        });

        // Mark flagged check-ins as sent
        if (checkin.flag) {
          await supabase
            .from("placements")
            .update({ [checkin.flag]: true })
            .eq("id", row.id);
        }

        labelSent++;
        sent++;
      } catch (err) {
        console.error(`[placement-checkin/${checkin.label}] Failed for ${user.phone_number}:`, err);
      }
    }

    results[checkin.label] = labelSent;
  }

  return NextResponse.json({ sent, breakdown: results });
}
