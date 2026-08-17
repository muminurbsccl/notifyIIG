import pg from "pg";

const RPC_NAME = "claim_notification_deliveries";
const LIMIT = 10;

function sanitizeEnv(name) {
  return Boolean(process.env[name] && process.env[name].trim() !== "");
}

function assertSafeDatabaseUrl(url) {
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }

  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const database = parsed.pathname.replace(/^\//, "");

  const allowedHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const allowedDatabaseSuffix = database.endsWith("_test");

  if (!allowedHost && !allowedDatabaseSuffix) {
    throw new Error(
      "Refusing to run against non-test database. Set ALLOW_NOTIFICATION_CLAIM_TEST=true and use localhost or *_test database",
    );
  }

  return { host, database };
}

async function runQuery(client, text, values = []) {
  return client.query(text, values);
}

function assertFlagEnabled() {
  if (process.env.ALLOW_NOTIFICATION_CLAIM_TEST !== "true") {
    throw new Error("Set ALLOW_NOTIFICATION_CLAIM_TEST=true to run claim verification");
  }
}

function collectIdSet(rows) {
  return new Set(rows.map((row) => row.id));
}

function overlap(a, b) {
  for (const value of a) {
    if (b.has(value)) return value;
  }
  return null;
}

async function runClaimVerification() {
  assertFlagEnabled();

  if (!sanitizeEnv("DATABASE_URL")) {
    throw new Error("DATABASE_URL is required");
  }

  const { host, database } = assertSafeDatabaseUrl(process.env.DATABASE_URL);

  const createClient = () =>
    new pg.Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });

  const setupClient = createClient();

  let providerId;
  let circuitId;
  let eventId;
  let deliveryIds = [];

  try {
    await setupClient.connect();

    await runQuery(
      setupClient,
      "begin",
    );

    const nowSuffix = `${Date.now()}`;
    const providerResult = await runQuery(
      setupClient,
      "insert into public.providers (code, name, active) values ($1, $2, true) returning id",
      [`verify-claim-${nowSuffix}`, "Claim Verification"],
    );
    providerId = providerResult.rows[0].id;

    const circuitResult = await runQuery(
      setupClient,
      "insert into public.circuits (provider_id, external_circuit_id, normalized_circuit_id, status, expiry_version, notification_enabled) values ($1, $2, $3, 'draft', 1, true) returning id",
      [providerId, `claim-${nowSuffix}`, `claim-${nowSuffix}`],
    );
    circuitId = circuitResult.rows[0].id;

    const eventResult = await runQuery(
      setupClient,
      "insert into public.notification_events (circuit_id, expiry_version, milestone_key, due_date, status) values ($1, 1, 'claim', current_date + interval '1 day', 'pending') returning id",
      [circuitId],
    );
    eventId = eventResult.rows[0].id;

    const deliveryInserts = [
      { targetHash: "claim-a", maskedTarget: "c***", status: "queued" },
      { targetHash: "claim-b", maskedTarget: "c***", status: "queued" },
      { targetHash: "claim-c", maskedTarget: "c***", status: "queued" },
    ];

    const deliveryInsertPromises = deliveryInserts.map((item, index) =>
      runQuery(
        setupClient,
        "insert into public.notification_deliveries (event_id, channel, target_hash, masked_target, target_ciphertext, idempotency_key, status, attempts) values ($1, 'email', $2, $3, $4, $5, 'queued', 0) returning id",
        [
          eventId,
          item.targetHash,
          item.maskedTarget,
          `cipher-${nowSuffix}-${index}`,
          `idempotency-${nowSuffix}-${index}`,
        ],
      ),
    );

    const insertedDeliveries = await Promise.all(deliveryInsertPromises);
    deliveryIds = insertedDeliveries.map((result) => result.rows[0].id);

    await runQuery(setupClient, "commit");
  } catch (error) {
    await runQuery(setupClient, "rollback").catch(() => {});
    throw error;
  } finally {
    await setupClient.end().catch(() => {});
  }

  const clientA = createClient();
  const clientB = createClient();

  await Promise.all([clientA.connect(), clientB.connect()]);

  try {
    const [claimA, claimB] = await Promise.all([
      clientA.query(`select * from public.${RPC_NAME}($1)`, [LIMIT]),
      clientB.query(`select * from public.${RPC_NAME}($1)`, [LIMIT]),
    ]);

    const setA = collectIdSet(claimA.rows);
    const setB = collectIdSet(claimB.rows);
    const overlapping = overlap(setA, setB);

    const claimed = new Set([...setA, ...setB]);
    for (const expectedId of deliveryIds) {
      if (!claimed.has(expectedId)) {
        throw new Error(`Delivery ${expectedId} was not claimed by either client`);
      }
    }

    if (overlapping) {
      throw new Error(`Detected overlapping claimed delivery: ${overlapping}`);
    }

    console.log("PASS: concurrent claims were disjoint", {
      host,
      database,
      claimsA: claimA.rowCount,
      claimsB: claimB.rowCount,
    });
  } finally {
    await Promise.all([clientA.end(), clientB.end()]).catch(() => {});

    const cleanup = createClient();
    try {
      await cleanup.connect();

      if (deliveryIds.length > 0) {
        await cleanup.query(
          `delete from public.notification_deliveries where id = any($1::uuid[])`,
          [deliveryIds],
        );
      }
      if (eventId) {
        await cleanup.query("delete from public.notification_events where id = $1", [eventId]);
      }
      if (circuitId) {
        await cleanup.query("delete from public.circuits where id = $1", [circuitId]);
      }
      if (providerId) {
        await cleanup.query("delete from public.providers where id = $1", [providerId]);
      }
    } finally {
      await cleanup.end().catch(() => {});
    }
  }
}

try {
  await runClaimVerification();
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
}
