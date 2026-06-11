import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Admin view — Authorization: Bearer DASHBOARD_SECRET_TOKEN
async function handleAdminRequest() {
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

// User dashboard view — ?token=USER_DASHBOARD_TOKEN
async function handleUserTokenRequest(token: string) {
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("*")
    .eq("dashboard_token", token)
    .gt("token_expires_at", new Date().toISOString())
    .single();

  if (userError || !user) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  return NextResponse.json({ user, profile: profile ?? null });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  // User dashboard request — token in query string
  if (token) {
    return handleUserTokenRequest(token);
  }

  // Admin request — secret in Authorization header
  const authHeader = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!authHeader || authHeader !== process.env.DASHBOARD_SECRET_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return handleAdminRequest();
}
