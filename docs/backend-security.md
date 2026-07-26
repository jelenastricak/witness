# Witness backend security notes

## Enforced now

- Public reporters have no direct entity permissions.
- Public access is limited to two narrow server functions: submission and capability-style status lookup by opaque `public_ref`.
- Internal data is protected with Base44 RLS. `user` can read internal records; only `admin` can create sites, alter packets, create timeline events, or request signed evidence URLs.
- Reporter name and email are admin-only fields.
- Evidence uses Base44 private storage; public status responses never serialize evidence records or private file URIs.
- Signed evidence URLs are generated only for admins and expire in 60–900 seconds.
- All server-side input is length-checked and enum-constrained. The public endpoint ignores direct attempts to set severity, ownership, status, or resolution.
- Every triage state transition writes a timeline record.

## Known limitations — not production-approved

- The public endpoint has no durable rate limit or CAPTCHA verification. Its honeypot and origin check are nuisance controls, not abuse prevention.
- `public_ref` is an opaque tracking capability, not user authentication. It must be high entropy and should not be included in analytics, logs, or public URLs that third parties can access.
- Evidence private storage was verified from an anonymous SDK client. The app must still enforce file size/type limits in the frontend before deployment.
- The backend is app-per-customer, not a shared multi-tenant SaaS control plane. Do not merge unrelated customer teams into the same Base44 app.
- Base44 app IDs are not credentials, but `base44/.app.jsonc` is ignored to avoid accidental project binding disclosure.

## Next security gate

Do not expose a real customer capture form until Cloudflare-backed bot protection and rate limiting have been implemented and tested against the deployed frontend origin.
