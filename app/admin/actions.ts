"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

export async function toggleJobActiveAction(fd: FormData) {
  const jobId = fd.get("jobId") as string;
  const active = fd.get("active") === "true";
  await supabase.from("jobs").update({ active }).eq("id", jobId);
  revalidatePath("/admin");
}

export async function recordPlacementAction(fd: FormData) {
  const userId = fd.get("userId") as string;
  const placedAt = new Date().toISOString();
  await supabase.from("users").update({ status: "placed" }).eq("id", userId);
  const { error } = await supabase
    .from("placements")
    .insert({ user_id: userId, placed_at: placedAt });
  if (error) console.error("[admin] Placement insert error:", error);
  revalidatePath("/admin");
}
