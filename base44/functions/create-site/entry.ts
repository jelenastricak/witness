import { createClientFromRequest } from "npm:@base44/sdk";
import { error, json, optionsResponse, readJson } from "../../shared/http.ts";
import { requireAdmin, statusFor } from "../../shared/auth.ts";
import { opaqueRef, optionalBoolean, optionalUrl, requiredString, slug } from "../../shared/validation.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return error("Method not allowed", 405);

  try {
    const base44 = createClientFromRequest(req);
    const user = await requireAdmin(base44);
    const body = await readJson(req);
    const name = requiredString(body.name, "name", 120);
    const siteSlug = slug(body.slug);
    const allowedOriginUrl = optionalUrl(body.allowed_origin, "allowed_origin");
    if (!allowedOriginUrl) return error("allowed_origin is required", 400);
    const allowedOrigin = new URL(allowedOriginUrl).origin;

    const existing = await base44.asServiceRole.entities.WitnessSite.filter({ slug: siteSlug }, undefined, 1);
    if (existing.length) return error("A site with that slug already exists", 409);

    const site = await base44.asServiceRole.entities.WitnessSite.create({
      name,
      slug: siteSlug,
      public_key: opaqueRef("wpk"),
      allowed_origin: allowedOrigin,
      capture_enabled: optionalBoolean(body.capture_enabled, "capture_enabled") ?? true,
      retention_days: 365,
      created_by_email: user.email,
    });

    return json({
      site: {
        id: site.id,
        name: site.name,
        slug: site.slug,
        public_key: site.public_key,
        allowed_origin: site.allowed_origin,
        capture_enabled: site.capture_enabled,
      },
    }, 201);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unable to create site";
    return error(message, statusFor(cause));
  }
});
