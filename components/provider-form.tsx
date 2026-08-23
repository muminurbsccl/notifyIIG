"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ProviderFormInitial = {
  code?: string;
  name?: string;
  active?: boolean;
  defaultResponsibleOfficer?: string | null;
  primaryOwnerUserId?: string | null;
  backupOwnerUserId?: string | null;
  notes?: string | null;
};
export type ProviderFormProfile = { id: string; email: string | null; full_name: string; role: string };

type ProviderFormProps = {
  initial?: ProviderFormInitial;
  providerId?: string;
  submitLabel?: string;
  profiles?: ProviderFormProfile[];
};

type FieldErrors = Record<string, string[] | undefined>;

function optionalText(value: string): string | null {
  return value.trim() === "" ? null : value.trim();
}

export function ProviderForm({ initial, providerId, submitLabel, profiles = [] }: ProviderFormProps) {
  const router = useRouter();
  const [values, setValues] = useState({
    code: initial?.code ?? "",
    name: initial?.name ?? "",
    active: initial?.active ?? false,
    defaultResponsibleOfficer: initial?.defaultResponsibleOfficer ?? "",
    primaryOwnerUserId: initial?.primaryOwnerUserId ?? "",
    backupOwnerUserId: initial?.backupOwnerUserId ?? "",
    notes: initial?.notes ?? "",
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof typeof values>(key: K, value: (typeof values)[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function fieldError(name: string): string | undefined {
    return fieldErrors[name]?.[0];
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setFieldErrors({});
    setSubmitting(true);
    try {
      const payload = {
        code: values.code.trim(),
        name: values.name.trim(),
        active: values.active,
        defaultResponsibleOfficer: optionalText(values.defaultResponsibleOfficer),
        primaryOwnerUserId: optionalText(values.primaryOwnerUserId),
        backupOwnerUserId: optionalText(values.backupOwnerUserId),
        notes: values.notes.trim() === "" ? null : values.notes,
      };
      const response = await fetch(providerId ? `/api/providers/${providerId}` : "/api/providers", {
        method: providerId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        setFormError(body.error?.message ?? "The provider could not be saved");
        setFieldErrors(body.error?.fields ?? {});
        return;
      }
      router.push(`/providers/${body.provider.id}`);
      router.refresh();
    } catch {
      setFormError("A network error occurred while saving the provider");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <div className="form-row">
        <label>
          Code
          <input
            maxLength={40}
            required
            value={values.code}
            onChange={(event) => set("code", event.target.value)}
          />
          {fieldError("code") && <p className="field-error">{fieldError("code")}</p>}
        </label>
        <label>
          Name
          <input
            maxLength={160}
            required
            value={values.name}
            onChange={(event) => set("name", event.target.value)}
          />
          {fieldError("name") && <p className="field-error">{fieldError("name")}</p>}
        </label>
      </div>
      <div className="form-row">
        <label>
          Default responsible officer
          <input
            maxLength={160}
            value={values.defaultResponsibleOfficer}
            onChange={(event) => set("defaultResponsibleOfficer", event.target.value)}
          />
          {fieldError("defaultResponsibleOfficer") && (
            <p className="field-error">{fieldError("defaultResponsibleOfficer")}</p>
          )}
        </label>
        <label>
          Primary owner (user ID)
            {profiles.length > 0 ? <select value={values.primaryOwnerUserId} onChange={(event) => set("primaryOwnerUserId", event.target.value)}><option value="">Select a user…</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.email || profile.id} ({profile.role})</option>)}</select> : <input value={values.primaryOwnerUserId} onChange={(event) => set("primaryOwnerUserId", event.target.value)} />}
          {fieldError("primaryOwnerUserId") && (
            <p className="field-error">{fieldError("primaryOwnerUserId")}</p>
          )}
        </label>
      </div>
      <div className="form-row">
        <label>
          Backup owner (user ID)
          {profiles.length > 0 ? <select value={values.backupOwnerUserId} onChange={(event) => set("backupOwnerUserId", event.target.value)}><option value="">Select a backup…</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.email || profile.id} ({profile.role})</option>)}</select> : <input value={values.backupOwnerUserId} onChange={(event) => set("backupOwnerUserId", event.target.value)} />}
        </label>
        <label className="form-check stack-gap">
          <input
            checked={values.active}
            type="checkbox"
            onChange={(event) => set("active", event.target.checked)}
          />
          <span>Active provider</span>
        </label>
      </div>
      <label>
        Notes
        <textarea rows={3} value={values.notes} onChange={(event) => set("notes", event.target.value)} />
      </label>
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      <div className="form-actions">
        <button className="button button-primary" disabled={submitting} type="submit">
          {submitting ? "Saving…" : submitLabel ?? "Save provider"}
        </button>
      </div>
    </form>
  );
}
