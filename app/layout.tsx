import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MainGig",
  description: "AI-powered career coaching over WhatsApp",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
