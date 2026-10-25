import { parseSchemeSnapshotDto, type SchemeSnapshotDto } from "./api-dto";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export async function parseSnapshotBody(request: Request): Promise<SchemeSnapshotDto> {
  const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new ApiRequestError(415, "content_type_must_be_application_json");
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 5 * 1024 * 1024) {
    throw new ApiRequestError(413, "snapshot_too_large");
  }

  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > 5 * 1024 * 1024) {
    throw new ApiRequestError(413, "snapshot_too_large");
  }

  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new ApiRequestError(400, "invalid_json");
  }

  try {
    return parseSchemeSnapshotDto(value);
  } catch {
    throw new ApiRequestError(400, "invalid_scheme_snapshot");
  }
}

export function apiError(code: string, status: number, extraHeaders?: HeadersInit): Response {
  return Response.json({ error: code }, {
    status,
    headers: { "Cache-Control": "no-store", ...Object.fromEntries(new Headers(extraHeaders)) },
  });
}

export function requestErrorResponse(error: unknown): Response {
  if (error instanceof ApiRequestError) return apiError(error.code, error.status);
  return apiError("database_unavailable", 503);
}

export function storedDrawingResponse(
  record: { drawingId: string; revisionNo: number; snapshot: unknown },
  status = 200,
): Response {
  return Response.json(record, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ETag: '"' + record.revisionNo + '"',
    },
  });
}
