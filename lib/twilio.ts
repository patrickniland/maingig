import twilio from "twilio";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const from = process.env.TWILIO_WHATSAPP_NUMBER!;

export async function sendWhatsAppMessage(to: string, body: string) {
  return client.messages.create({ from, to, body });
}
