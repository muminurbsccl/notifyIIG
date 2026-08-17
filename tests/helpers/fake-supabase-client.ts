// Minimal programmable Supabase-like fake client for engine tests.
// Contract: awaiting a query chain returns { data, error }; upsert(...).select(...)
// returns only the rows actually inserted (conflicts are skipped); update(...).eq(...)
// mutates matching rows.

export type Row = Record<string, unknown>;

type Filter =
  | { kind: "eq" | "match" | "in" | "not" | "lte" | "lt"; column: string; value: unknown }
  | { kind: "or"; column: string; value: { kind: string; column: string; value: unknown }[] };

type QueryOutcome = { data: unknown; error: null };

export type FakeClient = {
  from(table: string): Chain;
  rpc(functionName: string, args: Record<string, unknown>): RpcChain;
  _tables: Record<string, Row[]>;
  _upsertedEvents: string[];
  _upsertedDeliveries: string[];
};

type RpcChain = {
  then(
    onfulfilled?: (value: QueryOutcome) => QueryOutcome | PromiseLike<QueryOutcome>,
    onrejected?: (reason: unknown) => QueryOutcome | PromiseLike<QueryOutcome>,
  ): Promise<QueryOutcome | QueryOutcome>;
};

type Chain = {
  select(fields: string): Chain;
  eq(column: string, value: unknown): Chain;
  match(values: Record<string, unknown>): Chain;
  in(column: string, values: unknown[]): Chain;
  not(column: string, operator: string, value: unknown): Chain;
  lte(column: string, value: unknown): Chain;
  or(expression: string): Chain;
  order(column: string, options?: { ascending?: boolean }): Chain;
  range(start: number, end: number): Chain;
  limit(value: number): Chain;
  maybeSingle(): Chain;
  single(): Chain;
  upsert(rows: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): Chain;
  update(values: Row): Chain;
  then(
    onfulfilled?: (value: QueryOutcome) => QueryOutcome | PromiseLike<QueryOutcome>,
  ): Promise<QueryOutcome>;
};

function project(row: Row, fields: string[]): Row {
  if (fields.length === 0) return { ...row };
  const out: Row = {};
  for (const field of fields) out[field] = row[field];
  return out;
}

export function makeFakeClient(initial: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = structuredClone(initial);
  const upsertedEvents: string[] = [];
  const upsertedDeliveries: string[] = [];

  function matchRow(row: Row, filters: Filter[]): boolean {
    return filters.every((filter) => {
      if (filter.kind === "or") {
        return filter.value.some((clause) => {
          if (clause.kind === "eq-null") {
            return row[clause.column] === null || row[clause.column] === undefined;
          }
          return (
            row[clause.column] !== null &&
            row[clause.column] !== undefined &&
            String(row[clause.column]) <= String(clause.value)
          );
        });
      }
      const value = row[filter.column];
      switch (filter.kind) {
        case "eq":
          return value === filter.value;
        case "match":
          return value === filter.value;
        case "in":
          return (filter.value as unknown[]).includes(value);
        case "not":
          return value !== filter.value;
        case "lte":
          return (
            filter.value === null ||
            (value !== null && value !== undefined && String(value) <= String(filter.value))
          );
        case "lt":
          return value !== null && value !== undefined && String(value) < String(filter.value);
      }
    });
  }

  function buildQuery(table: string, initialFilters: Filter[]) {
    const filters: Filter[] = initialFilters;
    const state = {
      fields: [] as string[],
      maybeSingle: false,
      limitValue: Infinity as number,
    };

    const run = async (): Promise<QueryOutcome> => {
      let rows = tables[table] ?? [];
      const plainFilters = filters.filter((filter) => filter.kind !== "or");
      rows = rows.filter((row) => matchRow(row, plainFilters));
      const orClauses = filters.filter((filter) => filter.kind === "or");
      if (orClauses.length > 0) {
        rows = rows.filter((row) => matchRow(row, orClauses));
      }
      if (state.maybeSingle) {
        return { data: rows[0] ? project(rows[0], state.fields) : null, error: null };
      }
      return {
        data: rows.slice(0, state.limitValue).map((row) => project(row, state.fields)),
        error: null,
      };
    };

    const chain = {} as Record<string, unknown>;
    chain.select = (fields: string) => {
      state.fields = fields.split(",").map((field) => field.trim()).filter(Boolean);
      return chain;
    };
    chain.eq = (column: string, value: unknown) => {
      filters.push({ kind: "eq", column, value });
      return chain;
    };
    chain.match = (values: Record<string, unknown>) => {
      for (const [column, value] of Object.entries(values)) {
        filters.push({ kind: "match", column, value });
      }
      return chain;
    };
    chain.in = (column: string, values: unknown[]) => {
      filters.push({ kind: "in", column, value: values });
      return chain;
    };
    chain.not = (column: string, operator: string, value: unknown) => {
      filters.push({ kind: "not", column, value });
      return chain;
    };
    chain.lte = (column: string, value: unknown) => {
      filters.push({ kind: "lte", column, value });
      return chain;
    };
    chain.or = (expression: string) => {
      const clauses = expression.split(",").map((clause) => {
        const [column, op, ...rest] = clause.split(".");
        return {
          kind: op === "is" ? ("eq-null" as const) : ("lte" as const),
          column,
          value: op === "is" ? null : rest.join("."),
        };
      });
      filters.push({ kind: "or", column: "", value: clauses });
      return chain;
    };
    chain.order = () => chain;
    chain.range = () => chain;
    chain.limit = (value: number) => {
      state.limitValue = value;
      return chain;
    };
    chain.maybeSingle = () => {
      state.maybeSingle = true;
      return chain;
    };
    chain.single = () => {
      state.maybeSingle = true;
      return chain;
    };

    // Awaiting a select chain resolves like supabase-js: { data, error }.
    chain.then = (onfulfilled?: (value: QueryOutcome) => QueryOutcome | PromiseLike<QueryOutcome>) =>
      Promise.resolve(run()).then(onfulfilled);

    return { chain, run };
  }

  function normalizeDate(value: unknown): string {
    if (value === null || value === undefined) return "";
    return String(value);
  }

  function callEnsureDueNotificationEvents(args: Record<string, unknown>) {
    const circuitId = String(args.p_circuit_id);
    const expiryVersion = Number(args.p_expiry_version);
    const ruleId = args.p_rule_id !== undefined && args.p_rule_id !== null ? String(args.p_rule_id) : null;
    const milestones = Array.isArray(args.p_milestones) ? args.p_milestones : [];

    const candidateMilestones = milestones
      .filter((milestone) => {
        if (milestone === null || typeof milestone !== "object") return false;
        const candidate = milestone as Record<string, unknown>;
        return typeof candidate.dueDate === "string" && typeof candidate.key === "string";
      })
      .map((milestone) => {
        const item = milestone as Record<string, unknown>;
        return {
          key: String(item.key),
          dueDate: normalizeDate(item.dueDate),
          label: normalizeDate(item.label),
        };
      })
      .sort((left, right) => {
        if (left.dueDate < right.dueDate) return -1;
        if (left.dueDate > right.dueDate) return 1;
        if (left.key < right.key) return -1;
        if (left.key > right.key) return 1;
        return 0;
      });

    if (candidateMilestones.length === 0) return [] as string[];

    const existingStates = (tables.notification_milestone_states ?? []).filter(
      (row) =>
        String(row.circuit_id) === circuitId &&
        Number(row.expiry_version) === expiryVersion,
    );

    const existingStateKeys = new Set(existingStates.map((row) => String(row.milestone_key)));
    const now = new Date().toISOString();
    const eventIds: string[] = [];
    const createdAt = now;
    const isFirstInvocation = existingStates.length === 0;

    if (isFirstInvocation) {
      const catchupKeys: string[] = [];
      tables.notification_milestone_states ??= [];
      const lastIndex = candidateMilestones.length - 1;
      for (let index = 0; index < candidateMilestones.length; index += 1) {
        const milestone = candidateMilestones[index];
        if (index < lastIndex) {
          tables.notification_milestone_states.push({
            circuit_id: circuitId,
            expiry_version: expiryVersion,
            milestone_key: milestone.key,
            due_date: milestone.dueDate,
            state: "satisfied",
            event_id: null,
            created_at: now,
          });
          catchupKeys.push(milestone.key);
          continue;
        }

        const eventId = crypto.randomUUID();
        tables.notification_events ??= [];
        tables.notification_events.push({
          id: eventId,
          circuit_id: circuitId,
          expiry_version: expiryVersion,
          rule_id: ruleId,
          milestone_key: milestone.key,
          due_date: milestone.dueDate,
          status: "pending",
          generated_at: createdAt,
          is_catch_up: lastIndex > 0,
          catch_up_milestone_keys: lastIndex > 0 ? [...catchupKeys, milestone.key] : [],
        });
        tables.notification_milestone_states.push({
          circuit_id: circuitId,
          expiry_version: expiryVersion,
          milestone_key: milestone.key,
          due_date: milestone.dueDate,
          state: "event_created",
          event_id: eventId,
          created_at: now,
        });
        eventIds.push(eventId);
      }
      return eventIds;
    }

    for (const milestone of candidateMilestones) {
      if (existingStateKeys.has(milestone.key)) continue;

      const eventId = crypto.randomUUID();
      tables.notification_events ??= [];
      tables.notification_events.push({
        id: eventId,
        circuit_id: circuitId,
        expiry_version: expiryVersion,
        rule_id: ruleId,
        milestone_key: milestone.key,
        due_date: milestone.dueDate,
        status: "pending",
        generated_at: createdAt,
        is_catch_up: false,
        catch_up_milestone_keys: [],
      });
      tables.notification_milestone_states.push({
        circuit_id: circuitId,
        expiry_version: expiryVersion,
        milestone_key: milestone.key,
        due_date: milestone.dueDate,
        state: "event_created",
        event_id: eventId,
        created_at: now,
      });
      eventIds.push(eventId);
    }

    return eventIds;
  }

  function parseTimestamp(value: unknown): number {
    const asNumber = Number(value);
    if (!Number.isNaN(asNumber) && Number.isFinite(asNumber)) return asNumber;
    const parsed = Date.parse(normalizeDate(value));
    return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
  }

  function parseStatusReadyForClaim(row: Row, nowIso: string) {
    if (row.status !== "queued" && row.status !== "retry_scheduled") return false;
    if (row.status === "queued") return true;
    if (row.next_attempt_at === null || row.next_attempt_at === undefined) return true;
    const nextAttempt = parseTimestamp(row.next_attempt_at);
    return nextAttempt <= parseTimestamp(nowIso);
  }

  function callClaimNotificationDeliveries(args: Record<string, unknown>) {
    const limit = Math.max(0, Number(args.p_limit ?? 100));
    const nowIso = new Date().toISOString();
    const candidates = ((tables.notification_deliveries ?? []).filter((row) =>
      parseStatusReadyForClaim(row, nowIso),
    ) as Row[])
      .sort((left, right) => {
        if (String(left.updated_at || "") < String(right.updated_at || "")) return -1;
        if (String(left.updated_at || "") > String(right.updated_at || "")) return 1;
        return String(left.id).localeCompare(String(right.id));
      })
      .slice(0, limit);

    const claimedIds = new Set(candidates.map((row) => String(row.id)));
    const claimedRows: Row[] = [];
    for (const row of tables.notification_deliveries ?? []) {
      if (!claimedIds.has(String(row.id))) continue;
      const updatedAttempts = Number(row.attempts ?? 0) + 1;
      row.status = "sending";
      row.attempts = updatedAttempts;
      row.updated_at = nowIso;
      claimedRows.push({
        id: row.id,
        event_id: row.event_id,
        channel: row.channel,
        target_hash: row.target_hash,
        target_ciphertext: row.target_ciphertext,
        status: row.status,
        attempts: row.attempts,
        next_attempt_at: row.next_attempt_at,
        idempotency_key: row.idempotency_key,
      });
    }

    return claimedRows;
  }

    const client = {
      from: (table: string) => {
      const built = buildQuery(table, []);
      const chain = built.chain as Record<string, unknown>;
      chain.upsert = (values: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        const rows = Array.isArray(values) ? values : [values];
        const insertedRows: Row[] = [];
        for (const row of rows) {
          const inserted: Row = { ...row, id: (row.id as string) ?? crypto.randomUUID() };
          let skipped = false;
          if (options?.onConflict) {
            const keyColumns = options.onConflict.split(",").map((column) => column.trim());
            const conflict = tables[table]?.some((existing) =>
              keyColumns.every((column) => existing[column] === inserted[column]),
            );
            if (conflict) skipped = true;
          }
          if (skipped) continue;
          (tables[table] ??= []).push(inserted);
          insertedRows.push(inserted);
          if (table === "notification_events") upsertedEvents.push(inserted.id as string);
          if (table === "notification_deliveries") upsertedDeliveries.push(inserted.id as string);
        }
        chain.select = (fields: string) => {
          const fieldList = fields.split(",").map((field) => field.trim()).filter(Boolean);
          return {
            then: (resolve: (value: QueryOutcome) => void) => {
              resolve({ data: insertedRows.map((row) => project(row, fieldList)), error: null });
            },
          };
        };
        return chain;
      };
      chain.update = (values: Row) => {
        const updateFilters: Filter[] = [];
        const applyUpdate = (): Row[] => {
          const updated = (tables[table] ?? []).filter((row) => matchRow(row, updateFilters));
          for (const row of updated) Object.assign(row, values);
          return updated;
        };
        const updateChain: Record<string, unknown> = {
          eq: (column: string, value: unknown) => {
            updateFilters.push({ kind: "eq", column, value });
            return updateChain;
          },
          in: (column: string, values: unknown[]) => {
            updateFilters.push({ kind: "in", column, value: values });
            return updateChain;
          },
          then: (resolve: (value: QueryOutcome) => void) => {
            resolve({ data: applyUpdate().map((row) => ({ ...row })), error: null });
          },
          select: (fields: string) => {
            const fieldList = fields.split(",").map((field) => field.trim()).filter(Boolean);
            return {
              then: (resolve: (value: QueryOutcome) => void) => {
                resolve({ data: applyUpdate().map((row) => project(row, fieldList)), error: null });
              },
            };
          },
        };
        return updateChain;
      };
      return chain;
    },
    _tables: tables,
      _upsertedEvents: upsertedEvents,
      _upsertedDeliveries: upsertedDeliveries,
      rpc: (functionName: string, args: Record<string, unknown> = {}) => {
        const rpcChain: RpcChain = {
          then(onfulfilled?: (value: QueryOutcome) => QueryOutcome | PromiseLike<QueryOutcome>) {
            let data: QueryOutcome["data"];
            if (functionName === "ensure_due_notification_events") {
              data = callEnsureDueNotificationEvents(args);
            } else if (functionName === "claim_notification_deliveries") {
              data = callClaimNotificationDeliveries(args);
            } else {
              data = [];
            }
            return Promise.resolve(onfulfilled ? onfulfilled({ data, error: null }) : { data, error: null });
          },
        };
        return rpcChain;
      },
    } as unknown as FakeClient;

  return { client, tables };
}
