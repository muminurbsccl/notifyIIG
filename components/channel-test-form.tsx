"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const CHANNELS = ["email", "whatsapp", "discord"] as const;
type ChannelName = (typeof CHANNELS)[number];

export function ChannelTestForm() {
  const router = useRouter();
  const [channel, setChannel] = useState<ChannelName>("email");
  const [target, setTarget] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [mentionIds, setMentionIds] = useState("");
  const [optedIn, setOptedIn] = useState(false);
  const [optInSource, setOptInSource] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult("");
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { channel, target: target.trim() };
      if (channel === "email") {
        if (subject.trim()) payload.subject = subject.trim();
        if (bodyText.trim()) payload.bodyText = bodyText.trim();
      }
      if (channel === "whatsapp") {
        payload.optedIn = optedIn;
        if (optInSource.trim()) payload.optInSource = optInSource.trim();
      }
      if (channel === "discord" && mentionIds.trim()) {
        payload.mentionIds = mentionIds
          .split(/[\s,]+/)
          .map((value) => value.trim())
          .filter(Boolean);
      }
      const response = await fetch("/api/channels/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? "The channel test failed");
        return;
      }
      setResult(body.externalId ? `Sent — external id ${body.externalId}` : "Sent successfully");
      router.refresh();
    } catch {
      setError("A network error occurred while sending the test");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <div className="form-row">
        <label>
          Channel
          <select value={channel} onChange={(event) => setChannel(event.target.value as ChannelName)}>
            {CHANNELS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Test target
          <input
            placeholder={channel === "email" ? "ops@example.com" : channel === "whatsapp" ? "+8801712345678" : "https://discord.com/api/webhooks/…"}
            required
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          />
        </label>
      </div>

      {channel === "email" && (
        <div className="form-row">
          <label>
            Subject
            <input value={subject} onChange={(event) => setSubject(event.target.value)} />
          </label>
          <label>
            Body text
            <input value={bodyText} onChange={(event) => setBodyText(event.target.value)} />
          </label>
        </div>
      )}

      {channel === "whatsapp" && (
        <label className="form-check">
          <input
            checked={optedIn}
            type="checkbox"
            onChange={(event) => setOptedIn(event.target.checked)}
          />
          <span>
            Recipient has opted in
            <span className="form-hint">
              <br />
              Source: <input
                maxLength={160}
                placeholder="e.g. operator test, signed consent form"
                value={optInSource}
                onChange={(event) => setOptInSource(event.target.value)}
              />
            </span>
          </span>
        </label>
      )}

      {channel === "discord" && (
        <label>
          Mention user IDs (space or comma separated)
          <input value={mentionIds} onChange={(event) => setMentionIds(event.target.value)} />
        </label>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <p className="notice" role="status">
          {result}
        </p>
      )}
      <div className="form-actions">
        <button className="button button-primary" disabled={busy} type="submit">
          {busy ? "Sending…" : "Send test message"}
        </button>
      </div>
    </form>
  );
}
