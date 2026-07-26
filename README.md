# Witness backend

Witness preserves customer-reported friction as an accountable packet: what the customer was trying to do, what they said, relevant context and private evidence, who owns the decision, and the visible outcome.

This is a standalone Base44 backend. It was created as a fresh application in RaptorLabs's Base44 Builder workspace, but it shares no Talon Audit, TypeMIC, or other product code, data, assets, or customer reports.

## Live

- App: https://witness-c1b4526a.base44.app
- Base44 app ID: `6a6536ab03664e73c1b4526a` (an app identifier, not a credential)

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

## Frontend

A single-page React app with three views — capture, public status lookup, and internal triage — styled as a case-file dossier: a dark sidebar, rounded cards, and color-coded status/severity throughout the triage dashboard. See `frontend/README.md` for local setup.

## Local structure

```
base44/entities/       Data model and RLS
base44/functions/      Server functions
base44/shared/         Validation, auth, response, and serialization helpers
frontend/              React + Vite client (capture, status, triage views)
docs/                  Integration and security notes
```

`base44/.app.jsonc` links this directory to the Base44 app and is deliberately ignored by Git; the app ID above is not a secret and can be passed via `--app-id` or `BASE44_APP_ID` instead.

## Deployment

```bash
npx base44 login                       # first time only
npx base44 link --app-id <your-app-id> # binds this folder to your Base44 app
npx base44 deploy --yes                # entities, functions, and site in one step
```

Or step by step:

```bash
npx base44 entities push
npx base44 functions deploy
cd frontend && npm install && npm run build && cd ..
npx base44 site deploy --yes
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
