import { readFileSync } from "node:fs";
import pg from "pg";

const preview = JSON.parse(readFileSync("C:\\Users\\Mumin\\AppData\\Local\\Temp\\opencode\\preview-dump.json", "utf8"));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const ACTOR = "145f5f36-c1ae-4397-a8f9-a104d87194d0";
const step = (label) => console.log("STEP:", label);

try {
  await client.query("begin");
  step("insert import_batches");
  const batch = await client.query(
    `insert into public.import_batches (filename, checksum, sheet_names, preview_summary, status, created_by)
     values ($1, $2, $3::jsonb, jsonb_build_object('providerCount', 0), 'previewed', $4) returning id`,
    [preview.filename, preview.checksum, JSON.stringify(preview.sheetNames), ACTOR],
  );
  const batchId = batch.rows[0].id;

  step("provider loop");
  for (const provider of preview.providers) {
    const resolved = await client.query("select public.resolve_import_provider($1, $2) as id", [provider.code, provider.name]);
    let id = resolved.rows[0].id;
    if (!id) {
      const ins = await client.query(
        `insert into public.providers (code, name, active) values ($1, $2, false) on conflict (code) do nothing returning id`,
        [provider.code, provider.name],
      );
      id = ins.rows[0]?.id;
      if (!id) {
        const sel = await client.query("select id from public.providers where code = $1 limit 1", [provider.code]);
        id = sel.rows[0]?.id;
      }
    }
    if (!id) throw new Error(`provider ${provider.code} unresolvable after insert`);
    for (const source of provider.sources) {
      await client.query(
        `insert into public.source_lineage (entity_type, entity_id, import_batch_id, sheet_name, row_number, raw_identifier)
         values ('provider', $1, $2, $3, $4, $5)`,
        [id, batchId, source.sheetName, source.rowNumber, provider.code],
      );
    }
  }

  step("candidate loop");
  let n = 0;
  for (const item of preview.circuitCandidates) {
    n++;
    const normRes = await client.query("select public.normalize_import_identifier($1) as n", [item.externalCircuitId]);
    const normalizedId = normRes.rows[0].n;
    const providerRes = await client.query("select public.resolve_import_provider($1, $2) as id", [item.providerCode, item.providerName]);
    const providerId = providerRes.rows[0].id;
    if (!providerId) throw new Error(`candidate ${item.externalCircuitId}: provider ${item.providerCode} could not be resolved`);

    const expiry = item.expiryDate ? item.expiryDate : null;
    const dbDateStr = (await client.query("select timezone('Asia/Dhaka', now())::date::text as d")).rows[0].d;
    const computedStatus = expiry === null ? "draft" : expiry < dbDateStr ? "expired" : "active";
    if (item.status !== computedStatus) throw new Error(`candidate ${item.externalCircuitId}: status ${item.status} != derived ${computedStatus} (expiry ${expiry}, business ${dbDateStr})`);
    const wantNotif = computedStatus === "active";
    const wantOwner = computedStatus === "active" ? "BSCPLC IIG Support" : null;
    if (Boolean(item.notificationEnabled) !== wantNotif || (item.ownerOverride ?? null) !== wantOwner) {
      throw new Error(`candidate ${item.externalCircuitId}: notif/owner mismatch`);
    }

    const existing = await client.query(
      `select id from public.circuits where provider_id = $1 and normalized_circuit_id = $2 and status <> 'archived' limit 1`,
      [providerId, normalizedId],
    );
    if (existing.rows.length) throw new Error(`candidate ${item.externalCircuitId}: existing ${existing.rows[0].id} needs decision`);

    const ins = await client.query(
      `insert into public.circuits (
        provider_id, external_circuit_id, normalized_circuit_id, identifier_type,
        service_type, capacity, location, segment, connected_router, start_date, expiry_date,
        renewal_procedure_start_date, monthly_cost, currency, raw_cost_details, notes,
        status, notification_enabled, owner_override, verified_by, verified_at
      ) values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,timezone('utc', now())
      ) returning id`,
      [
        providerId, item.externalCircuitId, normalizedId, item.identifierType,
        item.serviceType ?? null, item.capacity ?? null, item.location ?? null, item.segment ?? null, item.connectedRouter ?? null,
        item.startDate ?? null, item.expiryDate ?? null, item.renewalProcedureStartDate ?? null,
        item.monthlyCost ?? null, item.currency ? item.currency.toUpperCase() : null, item.rawCostDetails ?? null, item.notes ?? null,
        computedStatus, wantNotif, wantOwner, ACTOR,
      ],
    );
    const circuitId = ins.rows[0].id;

    await client.query(
      `update public.circuit_identifiers set identifier_kind = $2, original_value = $3, normalized_value = $4 where circuit_id = $1 and is_primary`,
      [circuitId, item.identifiers.find((i) => i.primary)?.kind, item.externalCircuitId, normalizedId],
    );
    for (const ident of item.identifiers) {
      if (ident.primary) continue;
      const iNorm = (await client.query("select public.normalize_import_identifier($1) as n", [ident.value])).rows[0].n;
      await client.query(
        `insert into public.circuit_identifiers (circuit_id, identifier_kind, original_value, normalized_value, is_primary)
         values ($1,$2,$3,$4,false) on conflict (circuit_id, normalized_value) do update set original_value = excluded.original_value`,
        [circuitId, ident.kind, ident.value, iNorm],
      );
    }
    const primaryCount = (await client.query("select count(*)::int as c from public.circuit_identifiers where circuit_id = $1 and is_primary", [circuitId])).rows[0].c;
    if (primaryCount !== 1) throw new Error(`candidate ${item.externalCircuitId}: primary count ${primaryCount}`);

    for (const source of item.sources) {
      await client.query(
        `insert into public.source_lineage (entity_type, entity_id, import_batch_id, sheet_name, row_number, raw_identifier)
         values ('circuit', $1, $2, $3, $4, $5)`,
        [circuitId, batchId, source.sheetName, source.rowNumber, item.externalCircuitId],
      );
    }
    console.log(`  ok ${n}: ${item.externalCircuitId}`);
  }

  step("commit batch + audit");
  await client.query(`update public.import_batches set status = 'committed' where id = $1`, [batchId]);
  await client.query(
    `insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, after_json)
     values ($1, 'import.commit', 'import_batch', $2, '{"replica":true}')`,
    [ACTOR, batchId],
  );
  console.log("REPLICA COMPLETED — no exception");
} catch (err) {
  console.log("REPLICA FAILED with message:");
  console.log(err.message);
} finally {
  await client.query("rollback");
  console.log("rolled back — no production data touched");
  await client.end();
}
