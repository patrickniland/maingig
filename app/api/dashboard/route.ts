import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");

  if (!token || token !== process.env.DASHBOARD_SECRET_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [{ data: users, error: usersError }, { count: placements }] =
    await Promise.all([
      supabase
        .from("users")
        .select("id, phone_number, full_name, status, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("status", "placed"),
    ]);

  if (usersError) {
    console.error("Dashboard query error:", usersError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  return NextResponse.json({ users, placements: placements ?? 0 });
}
