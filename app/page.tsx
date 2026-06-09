import { supabase } from "@/lib/supabase";

export const revalidate = 60; // refresh every 60 seconds

async function getPlacements(): Promise<number> {
  const { count } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("status", "placed");
  return count ?? 0;
}

export default async function Home() {
  const placements = await getPlacements();

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        fontFamily: "system-ui, sans-serif",
        background: "#f0fdf4",
        gap: "1rem",
      }}
    >
      <h1 style={{ fontSize: "2.5rem", fontWeight: 700, color: "#166534" }}>
        MainGig
      </h1>
      <p style={{ fontSize: "1.125rem", color: "#4b5563" }}>
        AI-powered career coaching over WhatsApp
      </p>
      <div
        style={{
          background: "#fff",
          borderRadius: "1rem",
          padding: "2rem 3rem",
          boxShadow: "0 1px 8px rgba(0,0,0,0.08)",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "3.5rem", fontWeight: 800, color: "#16a34a" }}>
          {placements}
        </div>
        <div style={{ fontSize: "1rem", color: "#6b7280", marginTop: "0.25rem" }}>
          placements to date
        </div>
      </div>
    </main>
  );
}
