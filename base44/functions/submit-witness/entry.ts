import { createClientFromRequest } from "npm:@base44/sdk";
import { error, json, optionsResponse, readJson } from "../../shared/http.ts";
import { statusFor } from "../../shared/auth.ts";
import { opaqueRef, optionalBoolean, optionalEmail, optionalString, optionalUrl, requiredString, SEVERITIES } from "../../shared/validation.ts";

const EVIDENCE_KINDS = ["screenshot", "voice", "video", "document", "link", "other"] as const;
const CAPTURE_TYPES = ["screenshot", "voice", "video"] as const;
const PRIVATE_URI_PREFIXES = ["private/", "mp/private/"];
const SPAM_STATUS_THRESHOLD = 0.85;

interface TriageAssist {
  ai_summary?: string;
  ai_suggested_severity?: typeof SEVERITIES[number];
  ai_spam_score?: number;
  ai_spam_reason?: string;
}

async function assistTriage(base44: any, message: string, pageTitle?: string, userIntent?: string): Promise<TriageAssist> {
  try {
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: [
        "You triage incoming customer-friction reports for a product called Witness. Given the report below, respond only with the requested JSON.",
        "",
        `Report message: "${message}"`,
        pageTitle ? `Page: ${pageTitle}` : "",
        userIntent ? `What the customer was trying to do: ${userIntent}` : "",
        "",
        "Tasks:",
        "1. Write a one-sentence internal summary of the issue (max 160 characters).",
        "2. Suggest a severity (unknown, low, medium, high, critical) based on how much this blocks the customer.",
        "3. Estimate the likelihood (0 to 1) that this submission is spam, gibberish, or abusive rather than a genuine report, and give a short reason.",
      ].filter(Boolean).join("\n"),
      response_json_schema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          suggested_severity: { type: "string", enum: SEVERITIES },
          spam_score: { type: "number" },
          spam_reason: { type: "string" },
        },
        required: ["summary", "suggested_severity", "spam_score", "spam_reason"],
      },
    }) as { summary?: unknown; suggested_severity?: unknown; spam_score?: unknown; spam_reason?: unknown };

    const assist: TriageAssist = {};
    if (typeof result.summary === "string") assist.ai_summary = result.summary.slice(0, 400);
    if (typeof result.suggested_severity === "string" && (SEVERITIES as readonly string[]).includes(result.suggested_severity)) {
      assist.ai_suggested_severity = result.suggested_severity as typeof SEVERITIES[number];
    }
    if (typeof result.spam_score === "number" && Number.isFinite(result.spam_score)) {
      assist.ai_spam_score = Math.max(0, Math.min(1, result.spam_score));
    }
    if (typeof result.spam_reason === "string") assist.ai_spam_reason = result.spam_reason.slice(0, 300);
    return assist;
  } catch {
    // Triage assist is best-effort. A submission must succeed even when AI is unavailable.
    return {};
  }
}

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

    const pageTitle = optionalString(body.page_title, "page_title", 300);
    const userIntent = optionalString(body.user_intent, "user_intent", 500);
    const assist = await assistTriage(base44, message, pageTitle, userIntent);
    const looksLikeSpam = (assist.ai_spam_score ?? 0) >= SPAM_STATUS_THRESHOLD;

    const packet = await base44.asServiceRole.entities.WitnessPacket.create({
      site_id: site.id,
      public_ref: opaqueRef("wtn"),
      status: looksLikeSpam ? "spam" : "new",
      severity: "unknown",
      message,
      page_url: optionalUrl(body.page_url, "page_url"),
      page_title: pageTitle,
      user_intent: userIntent,
      capture_types: captureTypes,
      evidence_count: evidence.length,
      reporter_name: optionalString(body.reporter_name, "reporter_name", 160),
      reporter_email: reporterEmail,
      contact_consent: contactConsent,
      ai_summary: assist.ai_summary,
      ai_suggested_severity: assist.ai_suggested_severity,
      ai_spam_score: assist.ai_spam_score,
      ai_spam_reason: assist.ai_spam_reason,
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

    if (looksLikeSpam) {
      await base44.asServiceRole.entities.WitnessEvent.create({
        packet_id: packet.id,
        event_type: "marked_spam",
        message: `AI flagged as likely spam (score ${assist.ai_spam_score?.toFixed(2)}): ${assist.ai_spam_reason ?? "no reason given"}`,
        visibility: "internal",
        actor_kind: "system",
      });
    }

    return json({ accepted: true, public_ref: packet.public_ref, status: packet.status }, 201);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unable to submit report";
    return error(message, statusFor(cause));
  }
});
