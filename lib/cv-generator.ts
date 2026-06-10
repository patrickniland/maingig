import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import Anthropic from "@anthropic-ai/sdk";
import type { User, UserProfile } from "./supabase";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;
const LINE_GAP = 1.4;

async function generateSummary(user: User, profile: UserProfile): Promise<string> {
  const context = [
    user.full_name && `Name: ${user.full_name}`,
    user.location_area && `Location: ${user.location_area}`,
    profile.skills?.length && `Skills: ${profile.skills.join(", ")}`,
    profile.education_level && `Education: ${profile.education_level}`,
    profile.availability && `Availability: ${profile.availability}`,
    profile.work_experience?.length &&
      `Work experience: ${profile.work_experience
        .map((w) => [w.role, w.company, w.duration].filter(Boolean).join(" at "))
        .join("; ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `Write a professional 2–3 sentence CV summary for a job seeker. Third person, professional tone, South African job market. No filler phrases. Profile:\n\n${context}`,
      },
    ],
  });

  const block = response.content[0];
  return block.type === "text" ? block.text.trim() : "";
}

function wrapLines(
  text: string,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  size: number,
  maxWidth: number
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function generateCV(user: User, profile: UserProfile): Promise<Buffer> {
  const summary = await generateSummary(user, profile);

  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  function ensureSpace(needed: number) {
    if (y - needed < MARGIN) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  }

  function drawText(
    text: string,
    font: typeof regular,
    size: number,
    color = rgb(0, 0, 0),
    align: "left" | "center" = "left"
  ) {
    const lines = wrapLines(text, font, size, CONTENT_W);
    for (const line of lines) {
      ensureSpace(size * LINE_GAP);
      const textW = font.widthOfTextAtSize(line, size);
      const x = align === "center" ? (PAGE_W - textW) / 2 : MARGIN;
      page.drawText(line, { x, y, size, font, color });
      y -= size * LINE_GAP;
    }
  }

  function drawSection(title: string) {
    ensureSpace(32);
    y -= 10;
    page.drawText(title.toUpperCase(), { x: MARGIN, y, size: 11, font: bold, color: rgb(0, 0, 0) });
    y -= 14;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    });
    y -= 10;
  }

  // ── Header ────────────────────────────────────────────────
  drawText(user.full_name ?? "Candidate", bold, 22, rgb(0, 0, 0), "center");
  y -= 4;

  const contactParts = [user.phone_number, user.email, user.location_area].filter(Boolean) as string[];
  if (contactParts.length) {
    drawText(contactParts.join("  |  "), regular, 9, rgb(0.33, 0.33, 0.33), "center");
  }
  y -= 6;

  // ── Professional Summary ──────────────────────────────────
  if (summary) {
    drawSection("Professional Summary");
    drawText(summary, regular, 10);
  }

  // ── Work Experience ───────────────────────────────────────
  if (profile.work_experience?.length) {
    drawSection("Work Experience");
    for (const job of profile.work_experience) {
      ensureSpace(24);
      const roleText = job.role ?? "Role not specified";
      const metaText = [job.company, job.duration].filter(Boolean).join("  ·  ");
      drawText(roleText, bold, 10);
      if (metaText) drawText(metaText, regular, 9, rgb(0.4, 0.4, 0.4));
      y -= 4;
    }
  }

  // ── Education ─────────────────────────────────────────────
  if (profile.education_level) {
    drawSection("Education");
    drawText(profile.education_level, regular, 10);
  }

  // ── Skills ────────────────────────────────────────────────
  if (profile.skills?.length) {
    drawSection("Skills");
    drawText(profile.skills.join("  ·  "), regular, 10);
  }

  // ── Availability ──────────────────────────────────────────
  if (profile.availability) {
    drawSection("Availability");
    drawText(profile.availability, regular, 10);
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
