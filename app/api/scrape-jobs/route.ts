import { NextRequest, NextResponse } from "next/server";
import { scrapeAndSaveJobs } from "@/lib/job-scraper";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-scrape-secret");
  if (!secret || secret !== process.env.DASHBOARD_SECRET_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { added, skipped } = await scrapeAndSaveJobs();
    return NextResponse.json({ ok: true, added, skipped });
  } catch (err) {
    console.error("[scrape-jobs] Error:", err);
    return NextResponse.json({ error: "Scrape failed" }, { status: 500 });
  }
}
