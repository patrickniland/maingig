import Anthropic from "@anthropic-ai/sdk";
import PDFDocument from "pdfkit";
import type { User, UserProfile } from "./supabase";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

function drawSection(doc: PDFKit.PDFDocument, title: string) {
  doc
    .moveDown(0.6)
    .fontSize(11)
    .font("Helvetica-Bold")
    .text(title.toUpperCase(), { continued: false })
    .moveDown(0.1);
  const y = doc.y;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).strokeColor("#cccccc").lineWidth(0.5).stroke();
  doc.moveDown(0.3).font("Helvetica").fontSize(10);
}

export async function generateCV(user: User & { location_area?: string | null }, profile: UserProfile): Promise<Buffer> {
  const summary = await generateSummary(user, profile);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Header ────────────────────────────────────────────────
    doc
      .fontSize(22)
      .font("Helvetica-Bold")
      .text(user.full_name ?? "Candidate", { align: "center" });

    const contactParts = [
      user.phone_number,
      user.email,
      user.location_area,
    ].filter(Boolean);

    doc
      .moveDown(0.3)
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#555555")
      .text(contactParts.join("  |  "), { align: "center" })
      .fillColor("#000000");

    // ── Professional Summary ──────────────────────────────────
    if (summary) {
      drawSection(doc, "Professional Summary");
      doc.text(summary, { align: "justify" });
    }

    // ── Work Experience ───────────────────────────────────────
    if (profile.work_experience?.length) {
      drawSection(doc, "Work Experience");
      for (const job of profile.work_experience) {
        doc.font("Helvetica-Bold").text(job.role ?? "Role not specified", { continued: !!job.company });
        if (job.company) doc.font("Helvetica").text(`  —  ${job.company}`, { continued: !!job.duration });
        if (job.duration) doc.font("Helvetica").fillColor("#666666").text(`  (${job.duration})`).fillColor("#000000");
        doc.moveDown(0.2);
      }
    }

    // ── Education ─────────────────────────────────────────────
    if (profile.education_level) {
      drawSection(doc, "Education");
      doc.text(profile.education_level);
    }

    // ── Skills ────────────────────────────────────────────────
    if (profile.skills?.length) {
      drawSection(doc, "Skills");
      doc.text(profile.skills.join("  ·  "));
    }

    // ── Availability ──────────────────────────────────────────
    if (profile.availability) {
      drawSection(doc, "Availability");
      doc.text(profile.availability);
    }

    doc.end();
  });
}
