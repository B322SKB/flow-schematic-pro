import { spawn } from "node:child_process";
import type { SchemeSnapshotDto } from "./api-dto";

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface StoredDrawing {
  drawingId: string;
  revisionNo: number;
  snapshot: SchemeSnapshotDto;
}

export type UpdateDrawingResult = "updated" | "conflict" | "missing";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_V4.test(value);
}

export function getPostgresConfig(env: Record<string, string | undefined>): PostgresConfig {
  const required = ["PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD"] as const;
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length) {
    throw new Error("Missing PostgreSQL configuration: " + missing.join(", "));
  }

  const port = env.PGPORT === undefined ? 5432 : Number(env.PGPORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid PGPORT; expected an integer from 1 to 65535");
  }

  return {
    host: env.PGHOST!,
    port,
    database: env.PGDATABASE!,
    user: env.PGUSER!,
    password: env.PGPASSWORD!,
  };
}

/** Execute fixed SQL through psql without a shell; values are passed via stdin. */
export function queryPostgres(
  sql: string,
  sourceEnv: Record<string, string | undefined> = process.env,
): Promise<string> {
  const config = getPostgresConfig(sourceEnv);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: config.host,
    PGPORT: String(config.port),
    PGDATABASE: config.database,
    PGUSER: config.user,
    PGPASSWORD: config.password,
    PGCONNECT_TIMEOUT: sourceEnv.PGCONNECT_TIMEOUT ?? "5",
  };

  return new Promise((resolve, reject) => {
    const child = spawn("psql", ["-X", "-q", "-t", "-A", "--set=ON_ERROR_STOP=1"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.resume();
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("error", () => reject(new Error("Could not start the PostgreSQL client")));
    child.once("close", (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error("PostgreSQL query failed"));
    });
    child.stdin.end(sql + "\n");
  });
}

function encodeSnapshot(snapshot: SchemeSnapshotDto): string {
  return Buffer.from(JSON.stringify(snapshot), "utf8").toString("base64");
}

function decodeRow(encoded: string): StoredDrawing {
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as StoredDrawing;
  } catch {
    throw new Error("PostgreSQL returned an invalid drawing row");
  }
}

function encodedJsonSql(): string {
  return "replace(encode(convert_to(jsonb_build_object('drawingId', drawing_id, 'revisionNo', current_revision_no, 'snapshot', snapshot)::text, 'UTF8'), 'base64'), E'\\n', '')";
}

export async function createDrawing(snapshot: SchemeSnapshotDto): Promise<StoredDrawing | null> {
  const drawingId = crypto.randomUUID();
  const encoded = encodeSnapshot(snapshot);
  const snapshotSql = "convert_from(decode('" + encoded + "', 'base64'), 'UTF8')::jsonb";
  const sql = [
    "WITH inserted AS (",
    "INSERT INTO pid_drawings (drawing_id, current_revision_no, snapshot)",
    "VALUES ('" + drawingId + "'::uuid, 1, " + snapshotSql + ")",
    "ON CONFLICT (drawing_id) DO NOTHING",
    "RETURNING drawing_id, current_revision_no, snapshot",
    "), saved_revision AS (",
    "INSERT INTO pid_drawing_revisions (drawing_id, revision_no, snapshot)",
    "SELECT drawing_id, current_revision_no, snapshot FROM inserted",
    "RETURNING drawing_id",
    ")",
    "SELECT " + encodedJsonSql() + " FROM inserted;",
  ].join(" ");

  const result = await queryPostgres(sql);
  return result ? decodeRow(result) : null;
}

export async function readDrawing(drawingId: string): Promise<StoredDrawing | null> {
  if (!isUuid(drawingId)) return null;
  const sql = "SELECT " + encodedJsonSql() +
    " FROM pid_drawings WHERE drawing_id = '" + drawingId + "'::uuid;";
  const result = await queryPostgres(sql);
  return result ? decodeRow(result) : null;
}

export async function updateDrawing(
  drawingId: string,
  baseRevision: number,
  snapshot: SchemeSnapshotDto,
): Promise<UpdateDrawingResult> {
  if (!isUuid(drawingId)) return "missing";
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 1) {
    throw new Error("Invalid base revision");
  }

  const encoded = encodeSnapshot(snapshot);
  const snapshotSql = "convert_from(decode('" + encoded + "', 'base64'), 'UTF8')::jsonb";
  const idSql = "'" + drawingId + "'::uuid";
  const sql = [
    "WITH current_row AS MATERIALIZED (",
    "SELECT current_revision_no FROM pid_drawings WHERE drawing_id = " + idSql,
    "), updated AS (",
    "UPDATE pid_drawings",
    "SET current_revision_no = current_revision_no + 1, snapshot = " + snapshotSql + ", updated_at = now()",
    "WHERE drawing_id = " + idSql + " AND current_revision_no = " + String(baseRevision),
    "RETURNING drawing_id, current_revision_no, snapshot",
    "), saved_revision AS (",
    "INSERT INTO pid_drawing_revisions (drawing_id, revision_no, snapshot)",
    "SELECT drawing_id, current_revision_no, snapshot FROM updated",
    "RETURNING drawing_id",
    ")",
    "SELECT CASE",
    "WHEN EXISTS (SELECT 1 FROM updated) THEN 'updated'",
    "WHEN EXISTS (SELECT 1 FROM current_row) THEN 'conflict'",
    "ELSE 'missing' END;",
  ].join(" ");

  const result = await queryPostgres(sql);
  if (result === "updated" || result === "conflict") return result;
  return "missing";
}
