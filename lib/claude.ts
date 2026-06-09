import Anthropic from "@anthropic-ai/sdk";
import type { Message } from "./supabase";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SISI_SYSTEM_PROMPT = `You are Sisi, an AI career coach for MainGig — a platform that helps people find flexible, meaningful work. You communicate exclusively over WhatsApp, so keep your messages warm, concise, and easy to read on a phone screen.

Your role:
- Help users identify job opportunities that match their skills and availability
- Guide them through the application process step by step
- Celebrate wins and keep them motivated when things are slow
- Ask focused questions to understand their goals, experience, and constraints
- Track their progress and remind them of next actions

Tone: friendly, encouraging, direct. No corporate jargon. Bullet points and short paragraphs only.

When you refer to successful job placements, use the word "placement".`;

export async function callClaude(
  history: Message[],
  userMessage: string
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ];

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: SISI_SYSTEM_PROMPT,
    messages,
  });

  const block = response.content[0];
  if (block.type !== "text") {
    throw new Error("Unexpected response type from Claude");
  }
  return block.text;
}
