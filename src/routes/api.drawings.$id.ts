import { createFileRoute } from "@tanstack/react-router";
import { requireDrawingSession } from "@/lib/pid/api-auth";
import { apiError, parseSnapshotBody, requestErrorResponse, storedDrawingResponse } from "@/lib/pid/api-http";
import { isUuid, readDrawing, updateDrawing } from "@/lib/pid/postgres-store";

export const Route = createFileRoute("/api/drawings/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = requireDrawingSession(request);
        if (session instanceof Response) return session;
        if (!isUuid(params.id)) return apiError("invalid_drawing_id", 400);
        try {
          const record = await readDrawing(params.id);
          return record ? storedDrawingResponse(record) : apiError("drawing_not_found", 404);
        } catch {
          return apiError("database_unavailable", 503);
        }
      },
      PUT: async ({ request, params }) => {
        const session = requireDrawingSession(request);
        if (session instanceof Response) return session;
        if (!isUuid(params.id)) return apiError("invalid_drawing_id", 400);
        const match = /^"([1-9]\d*)"$/.exec(request.headers.get("if-match")?.trim() ?? "");
        if (!match) return apiError("if_match_revision_required", 428);
        const baseRevision = Number(match[1]);
        if (!Number.isSafeInteger(baseRevision)) return apiError("invalid_base_revision", 400);
        let snapshot;
        try { snapshot = await parseSnapshotBody(request); }
        catch (error) { return requestErrorResponse(error); }
        try {
          const result = await updateDrawing(params.id, baseRevision, snapshot);
          if (result === "missing") return apiError("drawing_not_found", 404);
          if (result === "conflict") return apiError("revision_conflict", 409);
          const record = await readDrawing(params.id);
          return record ? storedDrawingResponse(record) : apiError("drawing_not_found", 404);
        } catch {
          return apiError("database_unavailable", 503);
        }
      },
    },
  },
});
