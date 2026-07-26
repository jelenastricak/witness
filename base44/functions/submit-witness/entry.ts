import { createClientFromRequest } from "npm:@base44/sdk";
import { error, json, optionsResponse, readJson } from "../../shared/http.ts";
import { statusFor } from "../../shared/auth.ts";
import { opaqueRef, optionalBoolean, optionalEmail, optionalString, optionalUrl, requiredString } from "../../shared/validation.ts";

const EVIDENCE_KINDS = ["screenshot", "voice", "video", "document", "link", "other"] as const;
const CAPTURE_TYPES = ["screenshot", "voice", "video"] as const;
const PRIVATE_URI_PREFIXES = ["private/", "mp/private/"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return error("Method not allowed", 405);

  try {
    const base44 = createClientFromRequest(req);
    const body = await readJson(req);
    if (typeof body.website === "string" && body.website.trim()) {
      return json({ accepted: true }, 202);
    }

    const siteKey = requiredString(body.site_key, "site_key", 100);
    const sites = await base44.asServiceRole.entities.WitnessSite.filter({ public_key: siteKey }, undefined, 1);
    const site = sites[0];
    if (!site || !site.capture_enabled) return error("This reporting channel is unavailable", 404);

    const requestOrigin = req.headers.get("origin");
    if (requestOrigin && requestOrigin !== site.allowed_origin) {
      return error("This reporting channel is not configured for this origin", 403);
    }

    const message = requiredString(body.message, "message", 3000);
    const reporterEmail = optionalEmail(body.reporter_email, "reporter_email");
    const contactConsent = optionalBoolean(body.contact_consent, "contact_consent") ?? false;
    if (contactConsent && !reporterEmail) {
      return error("reporter_email is required when contact_consent is true", 400);
    }

    const rawEvidence = body.evidence ?? [];
    if (!Array.isArray(rawEvidence) || rawEvidence.length > 3) {
      return error("evidence must be an array containing no more than three items", 400);
    }

    const evidence = rawEvidence.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Each evidence item must be an object");
      }
      const item = value as Record<string, unknown>;
      const kind = item.kind;
      if (typeof kind !== "string" || !EVIDENCE_KINDS.includes(kind as typeof EVIDENCE_KINDS[number])) {
        throw new Error("Evidence kind is invalid");
      }
      const fileUri = requiredString(item.file_uri, "evidence.file_uri", 2048);
      if (!PRIVATE_URI_PREFIXES.some((prefix) => fileUri.startsWith(prefix))) {
        throw new Error("evidence.file_uri must be a private Base44 storage URI");
      }
      return {
        kind,
        file_uri: fileUri,
        label: optionalString(item.label, "evidence.label", 240),
        mime_type: optionalString(item.mime_type, "evidence.mime_type", 160),
        source_url: optionalUrl(item.source_url, "evidence.source_url"),
      };
    });

    const captureTypes = [
      "text",
      ...new Set(evidence.map((item) => CAPTURE_TYPES.includes(item.kind as typeof CAPTURE_TYPES[number]) ? item.kind : "other")),
    ];

    const packet = await base44.asServiceRole.entities.WitnessPacket.create({
      site_id: site.id,
      public_ref: opaqueRef("wtn"),
      status: "new",
      severity: "unknown",
      message,
      page_url: optionalUrl(body.page_url, "page_url"),
      page_title: optionalString(body.page_title, "page_title", 300),
      user_intent: optionalString(body.user_intent, "user_intent", 500),
      capture_types: captureTypes,
      evidence_count: evidence.length,
      reporter_name: optionalString(body.reporter_name, "reporter_name", 160),
      reporter_email: reporterEmail,
      contact_consent: contactConsent,
    });

    for (const item of evidence) {
      await base44.asServiceRole.entities.WitnessEvidence.create({
        packet_id: packet.id,
        ...item,
        created_by_kind: "reporter",
      });
    }

    await base44.asServiceRole.entities.WitnessEvent.create({
      packet_id: packet.id,
      event_type: "submitted",
      message: "Your report was received.",
      visibility: "public",
      actor_kind: "reporter",
    });

    return json({ accepted: true, public_ref: packet.public_ref, status: packet.status }, 201);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unable to submit report";
    return error(message, statusFor(cause));
  }
});
