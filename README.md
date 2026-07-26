# Witness backend

Witness preserves customer-reported friction as an accountable packet: what the customer was trying to do, what they said, relevant context and private evidence, who owns the decision, and the visible outcome.

This is a standalone Base44 backend. It was created as a fresh application in RaptorLabs’s Base44 Builder workspace, but it shares no Talon Audit, TypeMIC, or other product code, data, assets, or customer reports.

## Scope

```
customer capture → Witness Packet → private evidence → internal triage
→ assignment / decision → resolution → customer-visible status
```

The frontend is intentionally separate. Its integration contract is in `docs/frontend-integration.md`.

## Backend capabilities

- Base44 entities with restrictive RLS and field-level protections for reporter identity.
- Anonymous report submission and status lookup through server functions only.
- Authenticated internal triage with an append-only event timeline.
- Private Base44 evidence storage; staff receive short-lived signed URLs only.
- Realtime-ready entity subscriptions for the authenticated triage UI.

## Local structure

```
base44/entities/       Data model and RLS
base44/functions/      Server functions
base44/shared/         Validation, auth, response, and serialization helpers
docs/                  Integration and security notes
```

`base44/.app.jsonc` links this directory to the Base44 app and is deliberately ignored by Git.

## Deployment

```bash
cd /home/hermes/witness
npx base44 entities push
npx base44 types generate
npx base44 functions deploy
```

## Verified backend flow

A real deployed test exercised:

1. anonymous reporter submission;
2. anonymous public status lookup;
3. private Base44 upload;
4. packet creation and private evidence association;
5. admin triage to `resolved`;
6. a short-lived signed staff evidence link;
7. confirmation that the public response excludes the private file URI.

Temporary database test records were deleted after verification. Private storage verification artifacts contain no personal data.

## Production boundary

This is a credible backend foundation, not a finished public SaaS. Before exposing a public capture form to real traffic, add a durable abuse-control layer (for example Cloudflare Turnstile verification plus rate limits) and define retention/deletion policy for evidence and reporter data.
