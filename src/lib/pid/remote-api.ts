import { parseSchemeSnapshotDto, serializeSchemeSnapshot, type SchemeSnapshotDto } from "./api-dto";
import type { Scheme } from "./types";

export interface RemoteSession {
  email: string;
  expiresAt: number;
}

export interface RemoteDrawing {
  drawingId: string;
  revisionNo: number;
  snapshot: SchemeSnapshotDto;
}

export class RemoteApiError extends Error {
  constructor(readonly status: number, code: string) {
    super(code);
    this.name = "RemoteApiError";
  }
}

type Fetcher = typeof fetch;

async function readJson(response: Response): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new RemoteApiError(response.status, "invalid_server_response");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RemoteApiError(response.status, "invalid_server_response");
  }
  return value as Record<string, unknown>;
}

async function requestJson(
  path: string,
  init: RequestInit,
  fetcher: Fetcher,
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetcher(path, { ...init, credentials: "same-origin" });
  const body = await readJson(response);
  if (!response.ok) {
    const code = typeof body.error === "string" ? body.error : "remote_request_failed";
    throw new RemoteApiError(response.status, code);
  }
  return { response, body };
}

function parseRemoteDrawing(value: Record<string, unknown>): RemoteDrawing {
  if (
    typeof value.drawingId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.drawingId) ||
    typeof value.revisionNo !== "number" ||
    !Number.isSafeInteger(value.revisionNo) ||
    value.revisionNo < 1
  ) throw new RemoteApiError(502, "invalid_server_response");

  let snapshot: SchemeSnapshotDto;
  try {
    snapshot = parseSchemeSnapshotDto(value.snapshot);
  } catch {
    throw new RemoteApiError(502, "invalid_server_response");
  }
  return { drawingId: value.drawingId, revisionNo: value.revisionNo, snapshot };
}

export async function loginRemoteApi(email: string, password: string, fetcher: Fetcher = fetch): Promise<{ email: string }> {
  const { body } = await requestJson("/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  }, fetcher);
  if (typeof body.email !== "string") throw new RemoteApiError(502, "invalid_server_response");
  return { email: body.email };
}

export async function getRemoteSession(fetcher: Fetcher = fetch): Promise<RemoteSession | null> {
  const response = await fetcher("/api/auth", { method: "GET", credentials: "same-origin" });
  if (response.status === 401) return null;
  const body = await readJson(response);
  if (!response.ok) {
    throw new RemoteApiError(response.status, typeof body.error === "string" ? body.error : "remote_request_failed");
  }
  if (typeof body.email !== "string" || typeof body.expiresAt !== "number") {
    throw new RemoteApiError(502, "invalid_server_response");
  }
  return { email: body.email, expiresAt: body.expiresAt };
}

export async function logoutRemoteApi(fetcher: Fetcher = fetch): Promise<{ signedOut: true }> {
  const { body } = await requestJson("/api/auth", { method: "DELETE" }, fetcher);
  if (body.signedOut !== true) throw new RemoteApiError(502, "invalid_server_response");
  return { signedOut: true };
}

export async function createRemoteDrawing(scheme: Scheme, fetcher: Fetcher = fetch): Promise<RemoteDrawing> {
  const { body } = await requestJson("/api/drawings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(serializeSchemeSnapshot(scheme)),
  }, fetcher);
  return parseRemoteDrawing(body);
}

export async function loadRemoteDrawing(drawingId: string, fetcher: Fetcher = fetch): Promise<RemoteDrawing> {
  const { response, body } = await requestJson("/api/drawings/" + encodeURIComponent(drawingId), { method: "GET" }, fetcher);
  const drawing = parseRemoteDrawing(body);
  const etag = response.headers.get("etag");
  if (etag !== null && etag !== '"' + drawing.revisionNo + '"') {
    throw new RemoteApiError(502, "revision_header_mismatch");
  }
  return drawing;
}

export async function saveRemoteDrawing(
  drawingId: string,
  revisionNo: number,
  scheme: Scheme,
  fetcher: Fetcher = fetch,
): Promise<RemoteDrawing> {
  if (!Number.isSafeInteger(revisionNo) || revisionNo < 1) {
    throw new RemoteApiError(400, "invalid_base_revision");
  }
  const { response, body } = await requestJson("/api/drawings/" + encodeURIComponent(drawingId), {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "if-match": '"' + revisionNo + '"',
    },
    body: JSON.stringify(serializeSchemeSnapshot(scheme)),
  }, fetcher);
  const drawing = parseRemoteDrawing(body);
  const etag = response.headers.get("etag");
  if (etag !== null && etag !== '"' + drawing.revisionNo + '"') {
    throw new RemoteApiError(502, "revision_header_mismatch");
  }
  return drawing;
}
