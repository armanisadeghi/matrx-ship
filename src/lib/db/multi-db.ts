/**
 * Multi-database operations service.
 * Creates on-demand Postgres clients for any database
 * within this instance's Postgres container.
 */
import postgres from "postgres";
import { logger } from "@/lib/logger";

type Row = Record<string, unknown>;

// Connection pool cache — lazily created, reused per database
const pools = new Map<string, ReturnType<typeof postgres>>();

function getBaseUrl(): string {
  return (
    process.env.DATABASE_URL ?? "postgresql://ship:ship@localhost:5432/ship"
  );
}

/**
 * Get a Postgres client for a specific database name.
 * Reuses cached connections.
 */
function getClient(databaseName: string): ReturnType<typeof postgres> {
  if (pools.has(databaseName)) {
    return pools.get(databaseName)!;
  }

  const baseUrl = getBaseUrl();
  const url = baseUrl.replace(/\/[^/]+$/, `/${databaseName}`);
  const client = postgres(url, {
    max: 5,
    idle_timeout: 30,
    connect_timeout: 10,
  });

  pools.set(databaseName, client);
  return client;
}

/**
 * List all user-accessible databases in this Postgres instance.
 */
export async function listDatabases(): Promise<
  Array<{ name: string; size: string; sizeBytes: number }>
> {
  const sql = getClient("ship");
  const rows = await sql`
    SELECT datname AS name,
           pg_size_pretty(pg_database_size(datname)) AS size,
           pg_database_size(datname) AS size_bytes
    FROM pg_database
    WHERE datistemplate = false AND datname NOT IN ('postgres')
    ORDER BY datname
  `;
  return rows.map((r) => ({
    name: String(r.name),
    size: String(r.size),
    sizeBytes: Number(r.size_bytes),
  }));
}

/**
 * List all tables in a specific database.
 */
export async function listTables(
  databaseName: string,
): Promise<
  Array<{
    name: string;
    schema: string;
    rowCount: number;
    columnCount: number;
    size: string;
  }>
> {
  const sql = getClient(databaseName);
  const rows = await sql`
    SELECT t.tablename AS name,
           t.schemaname AS schema,
           COALESCE(s.n_live_tup, 0)::int AS row_count,
           (SELECT COUNT(*)::int FROM information_schema.columns c
            WHERE c.table_schema = t.schemaname AND c.table_name = t.tablename) AS column_count,
           pg_size_pretty(COALESCE(pg_total_relation_size(
             quote_ident(t.schemaname) || '.' || quote_ident(t.tablename)), 0)) AS size
    FROM pg_catalog.pg_tables t
    LEFT JOIN pg_stat_user_tables s ON s.schemaname = t.schemaname AND s.relname = t.tablename
    WHERE t.schemaname = 'public'
    ORDER BY t.tablename
  `;
  return rows.map((r) => ({
    name: String(r.name),
    schema: String(r.schema),
    rowCount: Number(r.row_count),
    columnCount: Number(r.column_count),
    size: String(r.size),
  }));
}

/**
 * Get column info for a table.
 */
export async function describeTable(
  databaseName: string,
  tableName: string,
): Promise<
  Array<{
    name: string;
    type: string;
    nullable: boolean;
    defaultValue: string | null;
    isPrimaryKey: boolean;
  }>
> {
  const sql = getClient(databaseName);
  const rows = await sql`
    SELECT c.column_name AS name,
           c.data_type AS type,
           c.is_nullable = 'YES' AS nullable,
           c.column_default AS default_value,
           COALESCE(
             (SELECT true FROM information_schema.table_constraints tc
              JOIN information_schema.constraint_column_usage ccu
                ON tc.constraint_name = ccu.constraint_name
              WHERE tc.table_name = c.table_name AND tc.table_schema = c.table_schema
                AND ccu.column_name = c.column_name AND tc.constraint_type = 'PRIMARY KEY'
              LIMIT 1), false
           ) AS is_primary_key
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = ${tableName}
    ORDER BY c.ordinal_position
  `;
  return rows.map((r) => ({
    name: String(r.name),
    type: String(r.type),
    nullable: Boolean(r.nullable),
    defaultValue: r.default_value ? String(r.default_value) : null,
    isPrimaryKey: Boolean(r.is_primary_key),
  }));
}

/**
 * Read rows from a table with optional filtering and pagination.
 */
export async function readRows(
  databaseName: string,
  tableName: string,
  options: {
    limit?: number;
    offset?: number;
    orderBy?: string;
    orderDir?: "asc" | "desc";
    where?: Record<string, unknown>;
  } = {},
): Promise<{ rows: Row[]; total: number }> {
  const sql = getClient(databaseName);
  const limit = Math.min(options.limit ?? 100, 500);
  const offset = options.offset ?? 0;

  // Safe table name (prevent injection)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    throw new Error("Invalid table name");
  }

  // Get total count
  const countResult = await sql.unsafe(
    `SELECT COUNT(*)::int AS total FROM "${tableName}"`,
  );
  const total = Number(countResult[0]?.total ?? 0);

  // Build query
  let query = `SELECT * FROM "${tableName}"`;
  const orderCol = options.orderBy ?? "ctid";
  const orderDir = options.orderDir === "asc" ? "ASC" : "DESC";
  query += ` ORDER BY "${orderCol}" ${orderDir}`;
  query += ` LIMIT ${limit} OFFSET ${offset}`;

  const rows = await sql.unsafe(query);
  return { rows: rows as Row[], total };
}

/**
 * Insert a row into a table.
 */
export async function insertRow(
  databaseName: string,
  tableName: string,
  data: Record<string, unknown>,
): Promise<Row> {
  const sql = getClient(databaseName);
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    throw new Error("Invalid table name");
  }

  const columns = Object.keys(data);
  const values = Object.values(data) as (string | number | boolean | null)[];
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const colList = columns.map((c) => `"${c}"`).join(", ");

  const result = await sql.unsafe(
    `INSERT INTO "${tableName}" (${colList}) VALUES (${placeholders}) RETURNING *`,
    values,
  );
  return result[0] as Row;
}

/**
 * Update a row by primary key.
 */
export async function updateRow(
  databaseName: string,
  tableName: string,
  pkColumn: string,
  pkValue: unknown,
  data: Record<string, unknown>,
): Promise<Row | null> {
  const sql = getClient(databaseName);
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    throw new Error("Invalid table name");
  }

  const setClauses = Object.keys(data)
    .map((col, i) => `"${col}" = $${i + 1}`)
    .join(", ");
  const values = [...Object.values(data), pkValue] as (string | number | boolean | null)[];

  const result = await sql.unsafe(
    `UPDATE "${tableName}" SET ${setClauses} WHERE "${pkColumn}" = $${values.length} RETURNING *`,
    values,
  );
  return (result[0] as Row) ?? null;
}

/**
 * Delete a row by primary key.
 */
export async function deleteRow(
  databaseName: string,
  tableName: string,
  pkColumn: string,
  pkValue: unknown,
): Promise<boolean> {
  const sql = getClient(databaseName);
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    throw new Error("Invalid table name");
  }

  const result = await sql.unsafe(
    `DELETE FROM "${tableName}" WHERE "${pkColumn}" = $1`,
    [pkValue as string | number | boolean | null],
  );
  return result.count > 0;
}

/**
 * Execute a raw SQL query against a specific database.
 */
export async function executeQuery(
  databaseName: string,
  query: string,
): Promise<{ rows: Row[]; rowCount: number }> {
  const sql = getClient(databaseName);
  const result = await sql.unsafe(query);
  return {
    rows: result as Row[],
    rowCount: result.count ?? (result as Row[]).length,
  };
}

/**
 * Search across all text columns in a table.
 */
export async function searchTable(
  databaseName: string,
  tableName: string,
  searchTerm: string,
  limit: number = 50,
): Promise<Row[]> {
  const sql = getClient(databaseName);
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    throw new Error("Invalid table name");
  }

  // Get text columns
  const textCols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tableName}
      AND data_type IN ('text', 'character varying', 'varchar')
    ORDER BY ordinal_position
  `;

  if (textCols.length === 0) return [];

  const conditions = textCols
    .map((c) => `"${c.column_name}"::text ILIKE $1`)
    .join(" OR ");

  const rows = await sql.unsafe(
    `SELECT * FROM "${tableName}" WHERE ${conditions} LIMIT ${limit}`,
    [`%${searchTerm}%`],
  );
  return rows as Row[];
}
