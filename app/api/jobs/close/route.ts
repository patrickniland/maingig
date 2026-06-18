import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const { jobId } = await req.json();
    if (!jobId || typeof jobId !== "string") {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    const { error } = await supabase
      .from("jobs")
      .update({ active: false })
      .eq("id", jobId);

    if (error) {
      console.error("[jobs/close] Supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[jobs/close] Unexpected error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
