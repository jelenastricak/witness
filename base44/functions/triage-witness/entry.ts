import { createClientFromRequest } from "npm:@base44/sdk";
import { error, json, optionsResponse, readJson } from "../../shared/http.ts";
import { requireAdmin, statusFor } from "../../shared/auth.ts";
import { enumValue, optionalEmail, optionalString, requiredString } from "../../shared/validation.ts";

const ACTIONS = ["acknowledge", "investigate", "resolve", "close", "reopen", "mark_spam"] as const;
const SEVERITIES = ["unknown", "low", "medium", "high", "critical"] as const;

const stateForAction: Record<typeof ACTIONS[number], string> = {
  acknowledge: "acknowledged",
  investigate: "investigating",
  resolve: "resolved",
  close: "closed",
  reopen: "investigating",
  mark_spam: "spam",
};

const eventForAction: Record<typeof ACTIONS[number], string> = {
  acknowledge: "acknowledged",
  investigate: "investigating",
  resolve: "resolved",
  close: "closed",
  reopen: "reopened",
  mark_spam: "marked_spam",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return error("Method not allowed", 405);

  try {
    const base44 = createClientFromRequest(req);
    const user = await requireAdmin(base44);
    const body = await readJson(req);
    const packetId = requiredString(body.packet_id, "packet_id", 120);
    const action = enumValue(body.action, "action", ACTIONS);
    const packet = await base44.asServiceRole.entities.WitnessPacket.get(packetId);
    if (!packet) return error("Witness Packet not found", 404);

    const now = new Date().toISOString();
    const publicMessage = optionalString(body.public_message, "public_message", 3000);
    const internalNote = optionalString(body.internal_note, "internal_note", 3000);
    const nextStatus = stateForAction[action];
    const update: Record<string, unknown> = { status: nextStatus };

    if (body.severity !== undefined) update.severity = enumValue(body.severity, "severity", SEVERITIES);
    if (body.assigned_to_email !== undefined) update.assigned_to_email = optionalEmail(body.assigned_to_email, "assigned_to_email");
    if (action === "acknowledge") update.acknowledged_at = now;
    if (action === "resolve") {
      update.resolved_at = now;
      update.resolution_summary = requiredString(body.resolution_summary, "resolution_summary", 3000);
    }
    if (publicMessage) update.last_public_update_at = now;

    const updated = await base44.asServiceRole.entities.WitnessPacket.update(packet.id, update);
    await base44.asServiceRole.entities.WitnessEvent.create({
      packet_id: packet.id,
      event_type: eventForAction[action],
      message: publicMessage ?? internalNote ?? undefined,
      visibility: publicMessage ? "public" : "internal",
      actor_kind: "team",
      actor_email: user.email,
    });

    return json({ packet: updated });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unable to triage Witness Packet";
    return error(message, statusFor(cause));
  }
});
