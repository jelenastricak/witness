import { createClientFromRequest } from "npm:@base44/sdk";
import { error, json, optionsResponse, readJson } from "../../shared/http.ts";
import { statusFor } from "../../shared/auth.ts";
import { publicEvent, publicPacket } from "../../shared/serializers.ts";
import { requiredString } from "../../shared/validation.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return error("Method not allowed", 405);

  try {
    const base44 = createClientFromRequest(req);
    const body = await readJson(req);
    const publicRef = requiredString(body.public_ref, "public_ref", 100);
    const packets = await base44.asServiceRole.entities.WitnessPacket.filter({ public_ref: publicRef }, undefined, 1);
    const packet = packets[0];
    if (!packet || packet.status === "spam") return error("Witness report not found", 404);

    const allEvents = await base44.asServiceRole.entities.WitnessEvent.filter(
      { packet_id: packet.id },
      "created_date",
      100,
    );
    const updates = allEvents
      .filter((event: any) => event.visibility === "public")
      .map(publicEvent);

    return json({ witness: publicPacket(packet), updates });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unable to retrieve report status";
    return error(message, statusFor(cause));
  }
});
