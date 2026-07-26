/**
 * Best-effort speech-to-text for voice evidence via the ElevenLabs API.
 * Returns undefined on any failure so a missing/misconfigured key, an API
 * outage, or an unsupported audio format never blocks report submission.
 */
export async function transcribeVoiceEvidence(base44: any, fileUri: string): Promise<string | undefined> {
  const apiKey = Deno.env.get("11Labs");
  if (!apiKey) return undefined;

  try {
    const { signed_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
      file_uri: fileUri,
      expires_in: 60,
    });

    const audioResponse = await fetch(signed_url);
    if (!audioResponse.ok) return undefined;
    const audioBlob = await audioResponse.blob();

    const form = new FormData();
    form.append("model_id", "scribe_v1");
    form.append("file", audioBlob, "voice-note");

    const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
    });
    if (!response.ok) return undefined;

    const data = await response.json();
    const text = typeof data.text === "string" ? data.text.trim() : "";
    return text ? text.slice(0, 5000) : undefined;
  } catch {
    return undefined;
  }
}
