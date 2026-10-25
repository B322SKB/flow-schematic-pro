import { createFileRoute } from "@tanstack/react-router";
import { apiError, parseSnapshotBody, requestErrorResponse, storedDrawingResponse } from "@/lib/pid/api-http";
import { createDrawing } from "@/lib/pid/postgres-store";

export const Route = createFileRoute("/api/drawings")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let snapshot;
        try {
          snapshot = await parseSnapshotBody(request);
        } catch (error) {
          return requestErrorResponse(error);
        }

        try {
          const created = await createDrawing(snapshot);
          if (!created) return apiError("drawing_already_exists", 409);
          return storedDrawingResponse(created, 201);
        } catch {
          return apiError("database_unavailable", 503);
        }
      },
    },
  },
});
