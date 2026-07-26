import { createClientFromRequest } from "npm:@base44/sdk";
import { error, json, optionsResponse, readJson } from "../../shared/http.ts";
import { statusFor } from "../../shared/auth.ts";
import { requiredString } from "../../shared/validation.ts";
import { transcribeVoiceEvidence } from "../../shared/transcription.ts";

const PRIVATE_URI_PREFIXES = ["private/", "mp/private/"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return error("Method not allowed", 405);

  try {
    const base44 = createClientFromRequest(req);
    const body = await readJson(req);

    const siteKey = requiredString(body.site_key, "site_key", 100);
    const sites = await base44.asServiceRole.entities.WitnessSite.filter({ public_key: siteKey }, undefined, 1);
    const site = sites[0];
    if (!site || !site.capture_enabled) return error("This reporting channel is unavailable", 404);

    const requestOrigin = req.headers.get("origin");
    if (requestOrigin && requestOrigin !== site.allowed_origin) {
      return error("This reporting channel is not configured for this origin", 403);
    }

    const fileUri = requiredString(body.file_uri, "file_uri", 2048);
    if (!PRIVATE_URI_PREFIXES.some((prefix) => fileUri.startsWith(prefix))) {
      return error("file_uri must be a private Base44 storage URI", 400);
    }

    const transcript = await transcribeVoiceEvidence(base44, fileUri);
    return json({ transcript: transcript ?? "" });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unable to transcribe recording";
    return error(message, statusFor(cause));
  }
});
