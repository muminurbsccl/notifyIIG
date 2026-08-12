// Minimal programmable Supabase-like fake client for engine tests.
// Contract: awaiting a query chain returns { data, error }; upsert(...).select(...)
// returns only the rows actually inserted (conflicts are skipped); update(...).eq(...)
// mutates matching rows.

export type Row = Record<string, unknown>;

type Filter =
  | { kind: "eq" | "match" | "in" | "not" | "lte" | "lt"; column: string; value: unknown }
  | { kind: "or"; column: string; value: { kind: string; column: string; value: unknown }[] };

type QueryOutcome = { data: Row | Row[] | null; error: null };

export type FakeClient = {
  from(table: string): Chain;
  _tables: Record<string, Row[]>;
  _upsertedEvents: string[];
  _upsertedDeliveries: string[];
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
  } as unknown as FakeClient;

  return { client, tables };
}
