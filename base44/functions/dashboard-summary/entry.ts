import { createClientFromRequest } from "npm:@base44/sdk";
import { error, json, optionsResponse } from "../../shared/http.ts";
import { requireAdmin, statusFor } from "../../shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return error("Method not allowed", 405);

  try {
    const base44 = createClientFromRequest(req);
    await requireAdmin(base44);
    const packets = await base44.asServiceRole.entities.WitnessPacket.list("-created_date", 500);
    const byStatus = Object.fromEntries([
      "new", "acknowledged", "investigating", "resolved", "closed", "spam",
    ].map((status) => [status, packets.filter((packet: any) => packet.status === status).length]));

    return json({
      total: packets.length,
      by_status: byStatus,
      unassigned_open: packets.filter((packet: any) =>
        ["new", "acknowledged", "investigating"].includes(packet.status) && !packet.assigned_to_email,
      ).length,
      recent_packets: packets.slice(0, 8),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unable to retrieve dashboard summary";
    return error(message, statusFor(cause));
  }
});
