import { createClientFromRequest } from "npm:@base44/sdk";
import { error, json, optionsResponse, readJson } from "../../shared/http.ts";
import { requireAdmin, statusFor } from "../../shared/auth.ts";
import { requiredString } from "../../shared/validation.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return error("Method not allowed", 405);

  try {
    const base44 = createClientFromRequest(req);
    await requireAdmin(base44);
    const body = await readJson(req);
    const evidenceId = requiredString(body.evidence_id, "evidence_id", 120);
    const evidence = await base44.asServiceRole.entities.WitnessEvidence.get(evidenceId);
    if (!evidence) return error("Evidence not found", 404);

    const requestedExpiry = typeof body.expires_in === "number" ? Math.floor(body.expires_in) : 300;
    if (!Number.isFinite(requestedExpiry) || requestedExpiry < 60 || requestedExpiry > 900) {
      return error("expires_in must be between 60 and 900 seconds", 400);
    }

    const result = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
      file_uri: evidence.file_uri,
      expires_in: requestedExpiry,
    });
    return json({ signed_url: result.signed_url, expires_in: requestedExpiry });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unable to create evidence access link";
    return error(message, statusFor(cause));
  }
});
