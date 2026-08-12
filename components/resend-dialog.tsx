"use client";

import { useEffect, useState } from "react";

type ResendDialogProps = {
  deliveryId: string;
  maskedTarget: string;
  onClose: () => void;
  onDone: () => void;
};

export function ResendDialog({ deliveryId, maskedTarget, onClose, onDone }: ResendDialogProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (reason.trim().length < 5) {
      setError("Explain the reason for the resend (at least 5 characters)");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/notifications/${deliveryId}/resend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? "The resend could not be queued");
        return;
      }
      onDone();
    } catch {
      setError("A network error occurred while queuing the resend");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      aria-modal="true"
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <div className="dialog">
        <h2 className="section-heading">Resend notification</h2>
        <p className="muted">
          A new delivery to <strong>{maskedTarget}</strong> will be queued for the next job run.
        </p>
        <form className="form-stack" onSubmit={handleSubmit}>
          <label>
            Reason
            <textarea
              autoFocus
              maxLength={1000}
              placeholder="Why is this delivery being resent?"
              required
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button className="button button-primary" disabled={busy} type="submit">
              {busy ? "Queuing…" : "Queue resend"}
            </button>
            <button className="button button-secondary" disabled={busy} onClick={onClose} type="button">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
