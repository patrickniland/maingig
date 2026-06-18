import * as cheerio from "cheerio";
import { supabase } from "./supabase";

const CATEGORIES = [
  "marketing",
  "retail assistant",
  "warehouse",
  "driver",
  "administrator",
  "customer service",
  "security",
  "cleaner",
  "bartender",
  "receptionist",
];

const BASE_URL = "https://za.indeed.com";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-ZA,en;q=0.9",
  Accept:
    "text/html,application/xhtml+xml,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
};

type ScrapedJob = {
  title: string;
  company: string | null;
  location_area: string;
  description: string;
  application_url: string;
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSearchUrl(query: string): string {
  const params = new URLSearchParams({
    q: query,
    l: "Cape Town",
    radius: "25",
  });
  return `${BASE_URL}/jobs?${params.toString()}`;
}

async function scrapeCategory(query: string): Promise<ScrapedJob[]> {
  const url = buildSearchUrl(query);
  let html: string;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, { headers: HEADERS, signal: controller.signal });
    clearTimeout(timeout);
    html = await response.text();
  } catch (err) {
    console.error(`[scraper] Failed to fetch "${query}":`, err);
    return [];
  }

  const $ = cheerio.load(html);
  const jobs: ScrapedJob[] = [];

  // Indeed renders job cards with data-jk attribute; selectors may need
  // updating if Indeed changes their HTML structure.
  $("[data-jk]").each((_, el) => {
    const card = $(el);

    const titleEl = card.find("h2.jobTitle a, [data-testid='jobTitle'] a").first();
    const title = titleEl.text().trim();
    if (!title) return;

    const href = titleEl.attr("href") ?? card.find("a[id^='job_']").attr("href") ?? "";
    const application_url = href.startsWith("http")
      ? href
      : `${BASE_URL}${href}`;

    const company =
      card.find("[data-testid='company-name'], .companyName").first().text().trim() || null;

    const location =
      card.find("[data-testid='text-location'], .companyLocation").first().text().trim();

    const description =
      card.find(".job-snippet, [data-testid='job-snippet']").first().text().trim();

    jobs.push({
      title,
      company,
      location_area: location || "Cape Town",
      description,
      application_url,
    });
  });

  return jobs;
}

async function jobExists(title: string, location_area: string): Promise<boolean> {
  const { data } = await supabase
    .from("jobs")
    .select("id")
    .eq("title", title)
    .eq("location_area", location_area)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

export async function scrapeAndSaveJobs(): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;

  for (const category of CATEGORIES) {
    console.log(`[scraper] Scraping category: "${category}"`);
    const jobs = await scrapeCategory(category);
    console.log(`[scraper] Found ${jobs.length} listings for "${category}"`);

    for (const job of jobs) {
      const exists = await jobExists(job.title, job.location_area);
      if (exists) {
        skipped++;
        continue;
      }

      const { error } = await supabase.from("jobs").insert({
        source: "indeed",
        title: job.title,
        description: job.description,
        location_area: job.location_area,
        active: true,
        verified: true,
        employer_id: null,
        application_url: job.application_url,
      });

      if (error) {
        console.error(`[scraper] Insert failed for "${job.title}":`, error.message);
      } else {
        added++;
      }
    }

    // Be polite — wait 2 seconds between category requests
    await delay(2000);
  }

  return { added, skipped };
}
