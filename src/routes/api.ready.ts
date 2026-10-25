import { createFileRoute } from "@tanstack/react-router";
import { apiError } from "@/lib/pid/api-http";
import { queryPostgres } from "@/lib/pid/postgres-store";

export const Route = createFileRoute("/api/ready")({
  server: {
    handlers: {
      GET: async () => {
        try {
          await queryPostgres("SELECT 1;");
          return Response.json({ status: "ready", storage: "postgres" }, { headers: { "Cache-Control": "no-store" } });
        } catch {
          return apiError("database_unavailable", 503);
        }
      },
    },
  },
});
