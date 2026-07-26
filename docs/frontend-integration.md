# Witness frontend integration contract

## 1. Client setup

Install the SDK in the frontend project:

```bash
npm install @base44/sdk
```

Set the Base44 app ID in the frontend environment. Read the actual value from the local backend binding at `../witness/base44/.app.jsonc`; do not commit it to a public repository.

```ts
import { createClient } from "@base44/sdk";

export const base44 = createClient({
  appId: import.meta.env.VITE_BASE44_APP_ID,
});
```

The public reporter route can use the unauthenticated client. Internal triage routes require Base44 login.

## 2. Role model and direct entity access

Base44 roles are app-wide:

| Role | Direct entity access | Function access |
| --- | --- | --- |
| anonymous reporter | none | `submit-witness`, `public-witness-status` |
| `user` | read packets, evidence metadata and events | no state changes |
| `admin` | full internal access | site creation, triage, signed evidence URLs, dashboard summary |

Do not use direct entity mutations for workflow state. Always use `triage-witness`, so state changes produce a timeline event.

Invite internal read-only users as `user`; invite people who can assign, decide, or resolve as `admin`.

## 3. Entities

### `WitnessSite`
Private admin configuration for a capture surface.

- `name`
- `slug`
- `public_key` — high-entropy key embedded in the public report form
- `allowed_origin`
- `capture_enabled`

### `WitnessPacket`
The core record.

- capture: `message`, `page_url`, `page_title`, `user_intent`, `capture_types`
- tracking: `public_ref`, `status`, `severity`, `evidence_count`
- protected reporter PII: `reporter_name`, `reporter_email`, `contact_consent`
- triage: `assigned_to_email`, `resolution_summary`, lifecycle timestamps

### `WitnessEvidence`
Private evidence metadata. `file_uri` is an opaque private Base44 storage URI, not a usable URL. Obtain a staff link only with `get-evidence-access`.

### `WitnessEvent`
Append-only timeline. `visibility: "public"` appears in reporter status; `visibility: "internal"` does not.

## 4. Admin bootstrap: create a capture site

This is normally a small internal settings screen. The caller must be an `admin`.

```ts
const { data } = await base44.functions.invoke("create-site", {
  name: "Acme checkout",
  slug: "acme-checkout",
  allowed_origin: "https://app.acme.com",
});

// Store / display data.site.public_key only where needed to configure the public form.
```

`allowed_origin` is canonicalized to its origin (`https://app.acme.com`), not a path.

## 5. Public reporter flow

### 5.1 Upload evidence privately

Do not use `UploadFile`: it makes public URLs. Use the private uploader and pass the returned opaque URI through unchanged.

```ts
const uploaded = await base44.integrations.Core.UploadPrivateFile({ file });
// uploaded.file_uri currently has a Base44-managed private URI format.
```

The deployed backend was verified with an anonymous private upload.

### 5.2 Submit a packet

```ts
const evidence = selectedFiles.length
  ? await Promise.all(selectedFiles.slice(0, 3).map(async (file) => {
      const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file });
      return {
        kind: file.type.startsWith("image/") ? "screenshot" : "document",
        file_uri,
        label: file.name,
        mime_type: file.type,
      };
    }))
  : [];

const { data } = await base44.functions.invoke("submit-witness", {
  site_key: witnessSiteKey,
  message: form.message,
  page_url: window.location.href,
  page_title: document.title,
  user_intent: form.intent || undefined,
  reporter_name: form.name || undefined,
  reporter_email: form.email || undefined,
  contact_consent: form.contactConsent,
  evidence,
  website: "", // honeypot input; leave empty for humans
});

// Store data.public_ref in local state or localStorage for the thank-you screen.
// Do not put it in a URL unless that page has strict no-referrer and analytics exclusions.
```

Constraints enforced server-side:

- message: 1–3,000 characters;
- at most three evidence items;
- only private Base44 storage URIs are accepted;
- email is required when contact consent is true;
- reporter input cannot set status, severity, ownership, or resolution.

### 5.3 Customer-visible status

```ts
const { data } = await base44.functions.invoke("public-witness-status", {
  public_ref,
});

// data.witness: public status and timing only
// data.updates: only public timeline entries
```

Never show raw packet records on this route.

## 6. Internal triage flow

```ts
const { data } = await base44.functions.invoke("triage-witness", {
  packet_id,
  action: "investigate", // acknowledge | investigate | resolve | close | reopen | mark_spam
  severity: "high",      // low | medium | high | critical | unknown
  assigned_to_email: "owner@example.com",
  internal_note: "Replicated on desktop checkout.",
  public_message: "We are investigating the confirmation flow.",
});
```

`resolve` accepts `resolution_summary`. The function sets lifecycle timestamps, stores the assignment, and writes an event. The UI should refresh from `data.packet` and the event subscription.

## 7. Staff evidence access

```ts
const { data } = await base44.functions.invoke("get-evidence-access", {
  evidence_id,
  expires_in: 300, // server permits 60–900 seconds
});

window.open(data.signed_url, "_blank", "noopener,noreferrer");
```

Never cache signed URLs or store them in entities.

## 8. Realtime triage UI

Direct reads are appropriate for authenticated internal views. Use functions for mutations.

```ts
const unsubscribe = base44.entities.WitnessPacket.subscribe(() => refreshPackets());
const stopEvents = base44.entities.WitnessEvent.subscribe(() => refreshTimeline());

// On component teardown:
unsubscribe();
stopEvents();
```

## 9. Dashboard summary

For the triage landing page, admins may call:

```ts
const { data } = await base44.functions.invoke("dashboard-summary", {});
// { total, open, unresolved, unassigned, resolved }
```

## 10. Required production work before public launch

1. Verify a Cloudflare Turnstile token in `submit-witness` and add durable edge rate limits. The existing honeypot and origin check are not sufficient anti-abuse controls.
2. Establish evidence and reporter-data retention/deletion rules, then implement a scheduled purge.
3. Decide whether the Base44 application remains a single customer workspace or moves to an explicit multi-tenant model. The current model is intentionally app-per-customer: clean, restrictive, and appropriate for the first live deployment.
4. Add reporter email verification before sending external status notifications.
5. Add audit export and operational monitoring before selling to regulated teams.
