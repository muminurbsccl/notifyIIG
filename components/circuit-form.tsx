"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { calculateInitialReminder } from "@/lib/domain/date-rules";

export type CircuitFormProvider = { id: string; name: string; code: string };
export type CircuitFormProfile = { id: string; email: string | null; full_name: string; role: string };

export type CircuitFormInitial = {
  providerId?: string;
  externalCircuitId?: string;
  identifierType?: string;
  serviceType?: string | null;
  capacity?: string | null;
  location?: string | null;
  startDate?: string | null;
  expiryDate?: string | null;
  status?: string;
  actionStatus?: string;
  ownerOverride?: string | null;
  ownerUserId?: string | null;
  backupOwnerUserId?: string | null;
  monthlyCost?: number | null;
  currency?: string | null;
  notes?: string | null;
  notificationEnabled?: boolean;
  notificationRuleId?: string | null;
};

type CircuitFormProps = {
  providers: CircuitFormProvider[];
  profiles?: CircuitFormProfile[];
  initial?: CircuitFormInitial;
  circuitId?: string;
  submitLabel?: string;
  managerMode?: boolean;
};

const IDENTIFIER_TYPES = ["circuit", "link", "durable"];
const STATUSES = ["draft", "active", "renewal_pending", "renewed", "expired", "terminated", "archived"];
const ACTION_STATUSES = ["no_action", "reviewing", "renewal_requested", "renewal_confirmed", "termination_planned", "closed"];

type FieldErrors = Record<string, string[] | undefined>;

function optionalText(value: string): string | null {
  return value.trim() === "" ? null : value.trim();
}

export function CircuitForm({
  providers,
  profiles = [],
  initial,
  circuitId,
  submitLabel,
  managerMode = false,
}: CircuitFormProps) {
  const router = useRouter();
  const [values, setValues] = useState(() => ({
    providerId: initial?.providerId ?? "",
    externalCircuitId: initial?.externalCircuitId ?? "",
    identifierType: initial?.identifierType ?? "circuit",
    serviceType: initial?.serviceType ?? "",
    capacity: initial?.capacity ?? "",
    location: initial?.location ?? "",
    startDate: initial?.startDate ?? "",
    expiryDate: initial?.expiryDate ?? "",
    status: initial?.status ?? "draft",
    actionStatus: initial?.actionStatus ?? "no_action",
    ownerOverride: initial?.ownerOverride ?? "",
    ownerUserId: initial?.ownerUserId ?? "",
    backupOwnerUserId: initial?.backupOwnerUserId ?? "",
    monthlyCost: initial?.monthlyCost === null || initial?.monthlyCost === undefined ? "" : String(initial.monthlyCost),
    currency: initial?.currency ?? "",
    notes: initial?.notes ?? "",
    notificationEnabled: initial?.notificationEnabled ?? true,
    notificationRuleId: initial?.notificationRuleId ?? "",
    verify: false,
  }));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof typeof values>(key: K, value: (typeof values)[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  const firstReminder =
    values.expiryDate && ["active", "renewal_pending"].includes(values.status)
      ? calculateInitialReminder(values.expiryDate)
      : null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setFieldErrors({});
    setSubmitting(true);
    try {
      if (managerMode) {
        const payload = {
          actionStatus: values.actionStatus,
          notes: values.notes === "" ? null : values.notes,
        };
        const response = await fetch(circuitId ? `/api/circuits/${circuitId}` : "/api/circuits", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await response.json();
        if (!response.ok) {
          setFormError(body.error?.message ?? "The update could not be completed");
          setFieldErrors(body.error?.fields ?? {});
          return;
        }
        router.refresh();
        return;
      }

      const payload = {
        providerId: values.providerId,
        externalCircuitId: values.externalCircuitId.trim(),
        identifierType: values.identifierType,
        serviceType: optionalText(values.serviceType),
        capacity: optionalText(values.capacity),
        location: optionalText(values.location),
        startDate: optionalText(values.startDate),
        expiryDate: optionalText(values.expiryDate),
        status: values.status,
        actionStatus: values.actionStatus,
        ownerOverride: optionalText(values.ownerOverride),
        ownerUserId: optionalText(values.ownerUserId),
        backupOwnerUserId: optionalText(values.backupOwnerUserId),
        monthlyCost: values.monthlyCost === "" ? null : Number(values.monthlyCost),
        currency: optionalText(values.currency),
        notes: values.notes.trim() === "" ? null : values.notes,
        notificationEnabled: values.notificationEnabled,
        notificationRuleId: optionalText(values.notificationRuleId),
        ...(values.verify ? { verify: true } : {}),
      };
      const response = await fetch(circuitId ? `/api/circuits/${circuitId}` : "/api/circuits", {
        method: circuitId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        setFormError(body.error?.message ?? "The circuit could not be saved");
        setFieldErrors(body.error?.fields ?? {});
        return;
      }
      router.push(`/circuits/${body.circuit.id}`);
      router.refresh();
    } catch {
      setFormError("A network error occurred while saving the circuit");
    } finally {
      setSubmitting(false);
    }
  }

  function fieldError(name: string): string | undefined {
    return fieldErrors[name]?.[0];
  }

  if (managerMode) {
    return (
      <form className="form-stack" onSubmit={handleSubmit}>
        <h2 className="section-heading">Renewal action</h2>
        <label>
          Action status
          <select value={values.actionStatus} onChange={(event) => set("actionStatus", event.target.value)}>
            {ACTION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label>
          Notes
          <textarea
            rows={4}
            value={values.notes}
            onChange={(event) => set("notes", event.target.value)}
          />
        </label>
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
        <div className="form-actions">
          <button className="button button-primary" disabled={submitting} type="submit">
            {submitting ? "Saving…" : "Save renewal action"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <div className="form-row">
        <label>
          Provider
          <select value={values.providerId} onChange={(event) => set("providerId", event.target.value)}>
            <option value="">Select a provider…</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
          {fieldError("providerId") && <p className="field-error">{fieldError("providerId")}</p>}
        </label>
        <label>
          Circuit ID
          <input
            maxLength={160}
            required
            value={values.externalCircuitId}
            onChange={(event) => set("externalCircuitId", event.target.value)}
          />
          {fieldError("externalCircuitId") && <p className="field-error">{fieldError("externalCircuitId")}</p>}
        </label>
      </div>

      <div className="form-row">
        <label>
          Identifier type
          <select value={values.identifierType} onChange={(event) => set("identifierType", event.target.value)}>
            {IDENTIFIER_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label>
          Service type
          <input
            maxLength={120}
            value={values.serviceType}
            onChange={(event) => set("serviceType", event.target.value)}
          />
        </label>
      </div>

      <div className="form-row">
        <label>
          Capacity
          <input maxLength={120} value={values.capacity} onChange={(event) => set("capacity", event.target.value)} />
        </label>
        <label>
          Location
          <input maxLength={200} value={values.location} onChange={(event) => set("location", event.target.value)} />
        </label>
      </div>

      <div className="form-row">
        <label>
          Start date
          <input type="date" value={values.startDate} onChange={(event) => set("startDate", event.target.value)} />
          {fieldError("startDate") && <p className="field-error">{fieldError("startDate")}</p>}
        </label>
        <label>
          Expiry date
          <input type="date" value={values.expiryDate} onChange={(event) => set("expiryDate", event.target.value)} />
          {fieldError("expiryDate") && <p className="field-error">{fieldError("expiryDate")}</p>}
          {firstReminder && <span className="form-hint">First reminder on {firstReminder}</span>}
        </label>
      </div>

      <div className="form-row">
        <label>
          Status
          <select value={values.status} onChange={(event) => set("status", event.target.value)}>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label>
          Action status
          <select value={values.actionStatus} onChange={(event) => set("actionStatus", event.target.value)}>
            {ACTION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="form-row">
        <label>
          Responsible officer (override)
          <input
            maxLength={160}
            value={values.ownerOverride}
            onChange={(event) => set("ownerOverride", event.target.value)}
          />
        </label>
        <label>
          Responsible user
          {profiles.length > 0 ? <select value={values.ownerUserId} onChange={(event) => set("ownerUserId", event.target.value)}><option value="">Select a user…</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.email || profile.id} ({profile.role})</option>)}</select> : <input value={values.ownerUserId} onChange={(event) => set("ownerUserId", event.target.value)} />}
        </label>
      </div>

      <div className="form-row">
        <label>
          Backup responsible user
          {profiles.length > 0 ? <select value={values.backupOwnerUserId} onChange={(event) => set("backupOwnerUserId", event.target.value)}><option value="">Select a backup…</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.email || profile.id} ({profile.role})</option>)}</select> : <input value={values.backupOwnerUserId} onChange={(event) => set("backupOwnerUserId", event.target.value)} />}
        </label>
        <label>
          Monthly cost
          <input
            min={0}
            step="0.01"
            type="number"
            value={values.monthlyCost}
            onChange={(event) => set("monthlyCost", event.target.value)}
          />
        </label>
      </div>

      <div className="form-row">
        <label>
          Currency
          <input
            maxLength={3}
            placeholder="BDT"
            value={values.currency}
            onChange={(event) => set("currency", event.target.value)}
          />
        </label>
        <label>
          Notification rule (ID)
          <input value={values.notificationRuleId} onChange={(event) => set("notificationRuleId", event.target.value)} />
        </label>
      </div>

      <label>
        Notes
        <textarea rows={4} value={values.notes} onChange={(event) => set("notes", event.target.value)} />
      </label>

      <label className="form-check">
        <input
          checked={values.notificationEnabled}
          type="checkbox"
          onChange={(event) => set("notificationEnabled", event.target.checked)}
        />
        <span>Send expiry notifications for this circuit</span>
      </label>

      <label className="form-check">
        <input
          checked={values.verify}
          type="checkbox"
          onChange={(event) => set("verify", event.target.checked)}
        />
        <span>I verify the expiry date and responsible officer are correct</span>
      </label>
      {circuitId && (
        <p className="form-hint">
          Verification is required when the expiry date changes or when activating a circuit.
        </p>
      )}

      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}

      <div className="form-actions">
        <button className="button button-primary" disabled={submitting} type="submit">
          {submitting ? "Saving…" : submitLabel ?? "Save circuit"}
        </button>
        {circuitId && (
          <button className="button button-secondary" type="button" onClick={() => router.push(`/circuits/${circuitId}`)}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
