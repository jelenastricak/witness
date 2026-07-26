import { createClientFromRequest } from "npm:@base44/sdk";
import { error, json, optionsResponse, readJson } from "../../shared/http.ts";
import { requireAdmin, statusFor } from "../../shared/auth.ts";
import { enumValue, optionalString, requiredString } from "../../shared/validation.ts";

const FIELDS = ["public_message", "resolution_summary"] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return error("Method not allowed", 405);

  try {
    const base44 = createClientFromRequest(req);
    await requireAdmin(base44);
    const body = await readJson(req);
    const packetId = requiredString(body.packet_id, "packet_id", 120);
    const field = enumValue(body.field, "field", FIELDS);
    const internalNote = optionalString(body.internal_note, "internal_note", 3000);

    const packet = await base44.asServiceRole.entities.WitnessPacket.get(packetId);
    if (!packet) return error("Witness Packet not found", 404);

    const instructions = field === "resolution_summary"
      ? "Write a clear, factual internal resolution record (max 500 characters): what was fixed, changed, or decided. Plain language. No apology filler, no marketing tone."
      : "Write a short, warm, plain-language update to tell this customer about progress on their report (max 400 characters). Do not invent specific dates or promises that were not given to you.";

    const prompt = [
      `You help a support team write ${field === "resolution_summary" ? "an internal resolution record" : "a customer-facing status update"} for a reported issue.`,
      "",
      `Customer's report: "${packet.message}"`,
      `Current status: ${packet.status}`,
      `Severity: ${packet.severity}`,
      internalNote ? `Team's internal note: "${internalNote}"` : "",
      "",
      instructions,
      "",
      "Respond with just the message text, no preamble or quotation marks.",
    ].filter(Boolean).join("\n");

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: "object",
        properties: { draft: { type: "string" } },
        required: ["draft"],
      },
    }) as { draft?: unknown };

    const draft = typeof result.draft === "string" ? result.draft.trim().slice(0, 3000) : "";
    return json({ draft });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unable to draft a message";
    return error(message, statusFor(cause));
  }
});
