import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isUnique: boolean;
  maxLength: number | null;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
}

export interface ForeignKeyInfo {
  constraintName: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
}

export interface TableInfo {
  name: string;
  schema: string;
  rowCount: number;
  sizeBytes: number;
  sizeFormatted: string;
  columnCount: number;
}

export interface TableSchema {
  name: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
}

type Row = Record<string, unknown>;

/**
 * List all user tables with row count and size estimates.
 */
export async function listTables(): Promise<TableInfo[]> {
  const result: Row[] = await db.execute(sql`
    SELECT
      t.tablename AS name,
      t.schemaname AS schema,
      COALESCE(s.n_live_tup, 0)::int AS row_count,
      COALESCE(pg_total_relation_size(quote_ident(t.schemaname) || '.' || quote_ident(t.tablename)), 0)::bigint AS size_bytes,
      pg_size_pretty(COALESCE(pg_total_relation_size(quote_ident(t.schemaname) || '.' || quote_ident(t.tablename)), 0)) AS size_formatted,
      (
        SELECT COUNT(*)::int
        FROM information_schema.columns c
        WHERE c.table_schema = t.schemaname AND c.table_name = t.tablename
      ) AS column_count
    FROM pg_catalog.pg_tables t
    LEFT JOIN pg_stat_user_tables s
      ON s.schemaname = t.schemaname AND s.relname = t.tablename
    WHERE t.schemaname = 'public'
      AND t.tablename NOT LIKE 'drizzle_%'
    ORDER BY t.tablename
  `);

  return result.map((row: Row) => ({
    name: String(row.name),
    schema: String(row.schema),
    rowCount: Number(row.row_count),
    sizeBytes: Number(row.size_bytes),
    sizeFormatted: String(row.size_formatted),
    columnCount: Number(row.column_count),
  }));
}

/**
 * Get detailed schema information for a specific table.
 */
export async function getTableSchema(tableName: string): Promise<TableSchema> {
  // Get columns
  const columnsResult: Row[] = await db.execute(sql`
    SELECT
      c.column_name AS name,
      c.data_type AS type,
      c.is_nullable = 'YES' AS nullable,
      c.column_default AS default_value,
      c.character_maximum_length AS max_length,
      COALESCE(
        (SELECT true FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu
           ON tc.constraint_name = ccu.constraint_name
         WHERE tc.table_name = c.table_name
           AND tc.table_schema = c.table_schema
           AND ccu.column_name = c.column_name
           AND tc.constraint_type = 'PRIMARY KEY'
         LIMIT 1),
        false
      ) AS is_primary_key,
      COALESCE(
        (SELECT true FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu
           ON tc.constraint_name = ccu.constraint_name
         WHERE tc.table_name = c.table_name
           AND tc.table_schema = c.table_schema
           AND ccu.column_name = c.column_name
           AND tc.constraint_type = 'UNIQUE'
         LIMIT 1),
        false
      ) AS is_unique
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = ${tableName}
    ORDER BY c.ordinal_position
  `);

  const columns: ColumnInfo[] = columnsResult.map((row: Row) => ({
    name: String(row.name),
    type: String(row.type),
    nullable: Boolean(row.nullable),
    defaultValue: row.default_value ? String(row.default_value) : null,
    isPrimaryKey: Boolean(row.is_primary_key),
    isUnique: Boolean(row.is_unique),
    maxLength: row.max_length ? Number(row.max_length) : null,
  }));

  // Get indexes
  const indexesResult: Row[] = await db.execute(sql`
    SELECT
      i.relname AS name,
      array_agg(a.attname ORDER BY x.n) AS columns,
      ix.indisunique AS is_unique,
      ix.indisprimary AS is_primary
    FROM pg_index ix
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS x(attnum, n)
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum
    WHERE n.nspname = 'public'
      AND t.relname = ${tableName}
    GROUP BY i.relname, ix.indisunique, ix.indisprimary
    ORDER BY i.relname
  `);

  const indexes: IndexInfo[] = indexesResult.map((row: Row) => ({
    name: String(row.name),
    columns: row.columns as string[],
    isUnique: Boolean(row.is_unique),
    isPrimary: Boolean(row.is_primary),
  }));

  // Get foreign keys
  const fksResult: Row[] = await db.execute(sql`
    SELECT
      tc.constraint_name,
      kcu.column_name AS column,
      ccu.table_name AS referenced_table,
      ccu.column_name AS referenced_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name = ${tableName}
    ORDER BY tc.constraint_name
  `);

  const foreignKeys: ForeignKeyInfo[] = fksResult.map((row: Row) => ({
    constraintName: String(row.constraint_name),
    column: String(row.column),
    referencedTable: String(row.referenced_table),
    referencedColumn: String(row.referenced_column),
  }));

  return { name: tableName, columns, indexes, foreignKeys };
}

/**
 * Get the full schema for all tables.
 */
export async function getFullSchema(): Promise<TableSchema[]> {
  const tables = await listTables();
  const schemas = await Promise.all(
    tables.map((t) => getTableSchema(t.name)),
  );
  return schemas;
}

/**
 * Get migration history from drizzle journal.
 */
export async function getMigrationHistory(): Promise<
  Array<{ version: string; tag: string; createdAt: number }>
> {
  try {
    const result: Row[] = await db.execute(sql`
      SELECT * FROM drizzle.__drizzle_migrations
      ORDER BY created_at DESC
    `);
    return result.map((row: Row) => ({
      version: String(row.hash),
      tag: String(row.tag ?? row.hash),
      createdAt: Number(row.created_at),
    }));
  } catch {
    return [];
  }
}
