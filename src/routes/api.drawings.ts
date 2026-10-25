import { createFileRoute } from "@tanstack/react-router";
import { requireDrawingSession } from "@/lib/pid/api-auth";
import { apiError, parseSnapshotBody, requestErrorResponse, storedDrawingResponse } from "@/lib/pid/api-http";
import { createDrawing } from "@/lib/pid/postgres-store";

export const Route = createFileRoute("/api/drawings")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = requireDrawingSession(request);
        if (session instanceof Response) return session;
        let snapshot;
        try { snapshot = await parseSnapshotBody(request); }
        catch (error) { return requestErrorResponse(error); }
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
