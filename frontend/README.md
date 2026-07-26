# Witness frontend

A Vite + React frontend for the deployed Witness Base44 backend.

## Local run

```bash
cd /home/hermes/witness/frontend
cp .env.example .env.local
npm install
npm run dev
```

The checked-in `.env.example` intentionally contains placeholders. A local `.env.local` is ignored by Git.

Environment variables:

```dotenv
VITE_BASE44_APP_ID=your-base44-app-id
VITE_WITNESS_SITE_KEY=the-public-key-created-by-create-site
```

`VITE_BASE44_APP_ID` and `VITE_WITNESS_SITE_KEY` are client-visible identifiers, not credentials. Never put admin tokens, service keys, or secrets in frontend variables.

## Screens

- **Capture** — anonymous report submission with private Base44 evidence upload.
- **Status** — reference-based customer view, with no reference in the URL.
- **Triage** — authenticated operator workspace for packets, evidence access, event history, and state transitions.

## Deployment

Base44 hosting is configured in `../base44/config.jsonc` to build this frontend and publish `frontend/dist`.

Before any deployment:

1. Build locally: `npm run build`.
2. Determine the final public origin.
3. Create or update a `WitnessSite` whose `allowed_origin` exactly matches that deployed origin.
4. Set the deployed environment’s `VITE_WITNESS_SITE_KEY` to that site's public key.
5. Complete the public-launch abuse gate: Turnstile verification, edge rate limiting, and file size/type restrictions.

Do not deploy public customer capture before those controls exist and have been verified.
