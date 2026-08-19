"use client";

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";

type ImportIssue = {
  code: string;
  message: string;
  source?: { sheetName: string; rowNumber: number };
  value?: string;
  decisionKey?: string;
};

type PreviewResponse = {
  providers: { name: string; code: string; sources: { sheetName: string; rowNumber: number }[] }[];
  circuitCandidates: {
    providerName: string;
    externalCircuitId: string;
    identifierType: string;
    sources: { sheetName: string; rowNumber: number }[];
    duplicate?: boolean;
  }[];
  issues: ImportIssue[];
  filename: string;
  checksum: string;
  previewChecksum: string;
  previewSignature: string;
  previewIssuedAt: string;
  sheetNames: string[];
};

type CommitCounts = {
  createdCircuits: number;
  skippedCircuits: number;
  mergedCircuits: number;
  versionedCircuits: number;
  invoiceCount: number;
};

// Builds the /api/import/commit request body from a preview response. The
// transport fields must sit at the TOP level of the payload — workbookPreview
// validation is strict and rejects unknown keys inside `preview`.
export function toCommitPayload(
  preview: PreviewResponse,
  decisions: Record<string, string>,
): {
  filename: string;
  checksum: string;
  previewChecksum: string;
  previewSignature: string;
  previewIssuedAt: string;
  sheetNames: string[];
  preview: unknown;
  decisions: Record<string, string>;
} {
  const { filename, checksum, previewChecksum, previewSignature, previewIssuedAt, sheetNames, ...previewData } = preview;
  return { filename, checksum, previewChecksum, previewSignature, previewIssuedAt, sheetNames, preview: previewData, decisions };
}

const DECISION_OPTIONS = ["skip", "merge", "create"] as const;

export function ImportReviewSummary({ preview }: { preview: PreviewResponse }): ReactElement {
  return (
    <>
      <p className="eyebrow">Review before commit</p>
      <h2 className="section-heading">{preview.filename}</h2>
      <dl className="detail-grid">
        <div>
          <dt>Providers</dt>
          <dd>{preview.providers.length}</dd>
        </div>
        <div>
          <dt>Circuit candidates</dt>
          <dd>{preview.circuitCandidates.length}</dd>
        </div>
        <div>
          <dt>Sheets</dt>
          <dd>{preview.sheetNames.join(", ")}</dd>
        </div>
      </dl>
    </>
  );
}

export function ImportWorkflow() {
  const router = useRouter();
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ batchId: string; counts: CommitCounts; issues: ImportIssue[] } | null>(null);

  const duplicateIssues = preview?.issues.filter((issue) => issue.code === "DUPLICATE_IDENTIFIER") ?? [];
  const blockErrors = preview?.issues.filter((issue) => issue.code !== "DUPLICATE_IDENTIFIER") ?? [];

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);
    setPreview(null);
    const input = (event.target as HTMLFormElement).elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      setError("Choose a workbook to upload");
      return;
    }
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/import/preview", { method: "POST", body: formData });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? "The workbook could not be reviewed");
        return;
      }
      setPreview(body.preview);
      setDecisions({});
    } catch {
      setError("A network error occurred while reviewing the workbook");
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    if (!preview) return;
    setError("");
    setBusy(true);
    try {
      const payload = toCommitPayload(preview, decisions);
      const response = await fetch("/api/import/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? "The import was rejected");
        return;
      }
      setResult({ batchId: body.batchId, counts: body.counts, issues: body.issues ?? [] });
      setPreview(null);
      router.refresh();
    } catch {
      setError("A network error occurred while committing the import");
    } finally {
      setBusy(false);
    }
  }

  function resetWorkflow() {
    setPreview(null);
    setResult(null);
    setDecisions({});
    setError("");
  }

  if (result) {
    return (
      <div className="data-card">
        <p className="eyebrow">Import committed</p>
        <h2 className="section-heading">Batch {result.batchId.slice(0, 8)}</h2>
        <dl className="detail-grid">
          <div>
            <dt>Circuits created</dt>
            <dd>{result.counts.createdCircuits}</dd>
          </div>
          <div>
            <dt>Circuits skipped</dt>
            <dd>{result.counts.skippedCircuits}</dd>
          </div>
          <div>
            <dt>Circuits merged</dt>
            <dd>{result.counts.mergedCircuits}</dd>
          </div>
          <div>
            <dt>Circuits versioned</dt>
            <dd>{result.counts.versionedCircuits}</dd>
          </div>
          <div>
            <dt>Invoices</dt>
            <dd>{result.counts.invoiceCount}</dd>
          </div>
        </dl>
        {result.issues.length > 0 && (
          <p className="notice notice-warning stack-gap">
            {result.issues.length} issue(s) recorded with this batch — review the audit log.
          </p>
        )}
        <div className="form-actions">
          <button className="button button-secondary" onClick={resetWorkflow} type="button">
            Import another workbook
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="data-card">
      {!preview ? (
        <form className="form-stack" onSubmit={handleUpload}>
          <label>
            Workbook (.xlsx)
            <input accept=".xlsx,.xls" name="file" required type="file" />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button className="button button-primary" disabled={busy} type="submit">
              {busy ? "Reviewing…" : "Review workbook"}
            </button>
          </div>
        </form>
      ) : (
        <>
          <ImportReviewSummary preview={preview} />

          {preview.circuitCandidates.length === 0 && (
            <p className="notice notice-warning stack-gap">
              Imported rows have no expiry dates and cannot send notifications. Verify expiry dates before activating
              circuits.
            </p>
          )}

          {blockErrors.length > 0 && (
            <div className="stack-gap">
              <h3 className="section-heading">Workbook issues</h3>
              <ul>
                {blockErrors.map((issue, index) => (
                  <li key={index} className="muted">
                    {issue.message}
                    {issue.source && ` (${issue.source.sheetName} row ${issue.source.rowNumber})`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {duplicateIssues.length > 0 && (
            <div className="stack-gap">
              <h3 className="section-heading">Duplicate decisions</h3>
              <p className="muted">
                Duplicate identifiers require an explicit review decision before commit.
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Identifier</th>
                      <th>Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {duplicateIssues.map((issue, index) => (
                      <tr key={`${issue.decisionKey}-${index}`}>
                        <td>{issue.value ?? issue.message}</td>
                        <td>
                          <select
                            aria-label={`Decision for ${issue.value ?? issue.decisionKey}`}
                            value={decisions[issue.decisionKey ?? ""] ?? ""}
                            onChange={(event) =>
                              setDecisions((current) => ({
                                ...current,
                                [issue.decisionKey ?? ""]: event.target.value,
                              }))
                            }
                          >
                            <option value="">Choose…</option>
                            {DECISION_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {error && (
            <p className="form-error stack-gap" role="alert">
              {error}
            </p>
          )}

          <div className="form-actions">
            <button className="button button-primary" disabled={busy} onClick={handleCommit} type="button">
              {busy ? "Committing…" : "Commit reviewed import"}
            </button>
            <button className="button button-secondary" disabled={busy} onClick={resetWorkflow} type="button">
              Start over
            </button>
          </div>
        </>
      )}
    </div>
  );
}
