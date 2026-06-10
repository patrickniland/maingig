import { PDFDocument, PDFPage, StandardFonts, rgb, type RGB } from "pdf-lib";
import Anthropic from "@anthropic-ai/sdk";
import type { User, UserProfile } from "./supabase";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Page geometry ──────────────────────────────────────────────────────────
const PW = 595.28;
const PH = 841.89;
const MX = 40;
const MT = 44;

// 35 / 65 column split
const LEFT_W = Math.round((PW - MX * 2) * 0.35);   // ~180
const COL_GAP = 15;
const RIGHT_X = MX + LEFT_W + COL_GAP;
const RIGHT_W = PW - RIGHT_X - MX;                  // ~320

// ── Typography ─────────────────────────────────────────────────────────────
const S_NAME = 28;
const S_JOBTITLE = 11;
const S_SECTION = 8;
const S_BODY = 9;
const LH = 1.55;

// ── Colors ─────────────────────────────────────────────────────────────────
const C_DARK = rgb(0.2, 0.2, 0.2);
const C_MID = rgb(0.3, 0.3, 0.3);
const C_LIGHT = rgb(0.5, 0.5, 0.5);
const C_RULE = rgb(0.8, 0.8, 0.8);

// ── Types ──────────────────────────────────────────────────────────────────
type Font = Awaited<ReturnType<PDFDocument["embedFont"]>>;

// ── Date formatting ────────────────────────────────────────────────────────
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function formatDate(dateStr: string): string {
  const match = dateStr.match(/^(\d{4})-(\d{2})$/);
  if (!match) return dateStr;
  const month = parseInt(match[2], 10);
  if (month < 1 || month > 12) return dateStr;
  return `${MONTHS[month - 1]} ${match[1]}`;
}

// ── Text helpers ───────────────────────────────────────────────────────────
function wrapText(text: string, font: Font, size: number, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > maxW) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function textBlock(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: Font,
  size: number,
  maxW: number,
  color: RGB = C_DARK
): number {
  for (const line of wrapText(text, font, size, maxW)) {
    page.drawText(line, { x, y, size, font, color });
    y -= size * LH;
  }
  return y;
}

function rule(page: PDFPage, x: number, y: number, w: number, thickness = 0.5) {
  page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness, color: C_RULE });
}

function sectionHead(page: PDFPage, title: string, x: number, y: number, w: number, boldFont: Font): number {
  page.drawText(title, { x, y, size: S_SECTION, font: boldFont, color: C_MID });
  y -= 11;
  rule(page, x, y, w);
  y -= 9;
  return y;
}

function colDivider(page: PDFPage, x: number, y: number, w: number): number {
  y -= 6;
  rule(page, x, y, w);
  y -= 10;
  return y;
}

// ── Claude profile summary ─────────────────────────────────────────────────
async function generateSummary(user: User, profile: UserProfile): Promise<string> {
  const ctx = [
    user.full_name && `Name: ${user.full_name}`,
    profile.job_title && `Title: ${profile.job_title}`,
    user.location_area && `Location: ${user.location_area}`,
    profile.skills?.length && `Skills: ${profile.skills.join(", ")}`,
    profile.education_level && `Education: ${profile.education_level}`,
    profile.availability && `Availability: ${profile.availability}`,
    profile.work_experience?.length &&
      `Experience: ${profile.work_experience
        .map((w) => [w.title, w.company].filter(Boolean).join(" at "))
        .join("; ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 250,
    system: "You output only the requested text. No preamble, no explanations, no markdown, no dashes, no notes. Just the text itself.",
    messages: [
      {
        role: "user",
        content: `Write a 3-4 sentence professional profile summary in third person for a CV. South African job market. No filler phrases.\n\nDetails:\n${ctx}`,
      },
    ],
  });

  const block = res.content[0];
  return block.type === "text" ? block.text.trim() : "";
}

// ── Main export ────────────────────────────────────────────────────────────
export async function generateCV(user: User, profile: UserProfile): Promise<Buffer> {
  const summary = await generateSummary(user, profile);

  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([PW, PH]);

  // ── Full-width header ────────────────────────────────────────────────────
  let y = PH - MT;

  // Name — centered, bold, 28pt
  const name = user.cv_full_name ?? user.full_name ?? "Candidate";
  const nameW = bold.widthOfTextAtSize(name, S_NAME);
  page.drawText(name, { x: (PW - nameW) / 2, y, size: S_NAME, font: bold, color: C_DARK });
  y -= S_NAME * 1.25;

  // Job title — centered, regular, 11pt
  if (profile.job_title) {
    const titleW = regular.widthOfTextAtSize(profile.job_title, S_JOBTITLE);
    page.drawText(profile.job_title, {
      x: (PW - titleW) / 2,
      y,
      size: S_JOBTITLE,
      font: regular,
      color: C_LIGHT,
    });
    y -= S_JOBTITLE * 1.7;
  }

  y -= 8;
  rule(page, MX, y, PW - MX * 2, 0.8);
  y -= 18;

  // ── Two columns start ────────────────────────────────────────────────────
  const colTopY = y;
  let lY = colTopY;
  let rY = colTopY;

  // Vertical divider between columns
  const divX = MX + LEFT_W + COL_GAP / 2;
  page.drawLine({
    start: { x: divX, y: colTopY },
    end:   { x: divX, y: 40 },
    thickness: 0.5,
    color: C_RULE,
  });

  // ── LEFT: CONTACT ────────────────────────────────────────────────────────
  lY = sectionHead(page, "CONTACT", MX, lY, LEFT_W, bold);
  for (const line of [user.phone_number, user.email, user.location_area].filter(Boolean) as string[]) {
    lY = textBlock(page, line, MX, lY, regular, S_BODY, LEFT_W);
  }

  // ── LEFT: SKILLS ─────────────────────────────────────────────────────────
  if (profile.skills?.length) {
    lY = colDivider(page, MX, lY, LEFT_W);
    lY = sectionHead(page, "SKILLS", MX, lY, LEFT_W, bold);
    for (const skill of profile.skills) {
      lY = textBlock(page, skill, MX, lY, regular, S_BODY, LEFT_W);
    }
  }

  // ── LEFT: EDUCATION ───────────────────────────────────────────────────────
  const eduEntries = profile.education?.length
    ? profile.education
    : profile.education_level
    ? [{ qualification: profile.education_level }]
    : [];

  if (eduEntries.length) {
    lY = colDivider(page, MX, lY, LEFT_W);
    lY = sectionHead(page, "EDUCATION", MX, lY, LEFT_W, bold);
    for (const edu of eduEntries) {
      if (edu.qualification) lY = textBlock(page, edu.qualification, MX, lY, bold, S_BODY, LEFT_W);
      if (edu.institution)   lY = textBlock(page, edu.institution, MX, lY, bold, S_BODY + 1, LEFT_W);
      if (edu.date_range)    lY = textBlock(page, edu.date_range, MX, lY, regular, S_BODY, LEFT_W, C_LIGHT);
      if (edu.description)   lY = textBlock(page, edu.description, MX, lY, regular, S_BODY, LEFT_W);
      lY -= 5;
    }
  }

  // ── LEFT: LANGUAGES ──────────────────────────────────────────────────────
  if (profile.languages_spoken?.length) {
    lY = colDivider(page, MX, lY, LEFT_W);
    lY = sectionHead(page, "LANGUAGES", MX, lY, LEFT_W, bold);
    for (const lang of profile.languages_spoken) {
      lY = textBlock(page, lang, MX, lY, regular, S_BODY, LEFT_W);
    }
  }

  // ── RIGHT: PROFILE ────────────────────────────────────────────────────────
  if (summary) {
    rY = sectionHead(page, "PROFILE", RIGHT_X, rY, RIGHT_W, bold);
    rY = textBlock(page, summary, RIGHT_X, rY, regular, S_BODY, RIGHT_W);
  }

  // ── RIGHT: WORK EXPERIENCE ────────────────────────────────────────────────
  if (profile.work_experience?.length) {
    rY = colDivider(page, RIGHT_X, rY, RIGHT_W);
    rY = sectionHead(page, "WORK EXPERIENCE", RIGHT_X, rY, RIGHT_W, bold);

    for (const job of profile.work_experience) {
      // Job title — bold, own line
      if (job.title) {
        rY = textBlock(page, job.title, RIGHT_X, rY, bold, S_BODY, RIGHT_W);
      }

      // Company (left) | date range (right) — same line
      if (job.company || job.start_date) {
        const dateRange = [
          job.start_date ? formatDate(job.start_date) : null,
          job.end_date   ? formatDate(job.end_date)   : "Present",
        ]
          .filter(Boolean)
          .join(" – ");

        if (job.company) {
          page.drawText(job.company, { x: RIGHT_X, y: rY, size: S_BODY, font: regular, color: C_MID });
        }
        if (dateRange) {
          const drW = regular.widthOfTextAtSize(dateRange, S_BODY);
          page.drawText(dateRange, {
            x: RIGHT_X + RIGHT_W - drW,
            y: rY,
            size: S_BODY,
            font: regular,
            color: C_LIGHT,
          });
        }
        rY -= S_BODY * LH;
      }

      // Responsibilities — bullet points
      const bulletPoints = job.duties ?? job.responsibilities ?? [];
      if (bulletPoints.length) {
        rY -= 2;
        for (const resp of bulletPoints) {
          rY = textBlock(page, `•  ${resp}`, RIGHT_X + 8, rY, regular, S_BODY, RIGHT_W - 8);
        }
      }

      rY -= 10;
    }
  }

  // ── RIGHT: AWARDS ─────────────────────────────────────────────────────────
  if (profile.awards?.length) {
    rY = colDivider(page, RIGHT_X, rY, RIGHT_W);
    rY = sectionHead(page, "AWARDS", RIGHT_X, rY, RIGHT_W, bold);
    for (const award of profile.awards) {
      rY = textBlock(page, `•  ${award}`, RIGHT_X, rY, regular, S_BODY, RIGHT_W);
    }
  }

  // ── RIGHT: REFERENCES ─────────────────────────────────────────────────────
  if (profile.references?.length) {
    rY = colDivider(page, RIGHT_X, rY, RIGHT_W);
    rY = sectionHead(page, "REFERENCES", RIGHT_X, rY, RIGHT_W, bold);
    for (const ref of profile.references) {
      if (ref.name) rY = textBlock(page, ref.name, RIGHT_X, rY, bold, S_BODY, RIGHT_W);
      const meta = [ref.role, ref.phone].filter(Boolean).join("  ·  ");
      if (meta) rY = textBlock(page, meta, RIGHT_X, rY, regular, S_BODY, RIGHT_W, C_LIGHT);
      rY -= 4;
    }
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
