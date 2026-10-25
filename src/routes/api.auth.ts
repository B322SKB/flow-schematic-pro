import { createFileRoute } from "@tanstack/react-router";
import { apiError } from "@/lib/pid/api-http";
import {
  clearedSessionCookie,
  createSessionToken,
  getAuthConfig,
  readSessionFromRequest,
  sessionCookie,
  verifyPassword,
} from "@/lib/pid/auth";

function unavailable(): Response {
  return apiError("authentication_not_configured", 503);
}

function noStoreJson(body: unknown, status = 200, cookie?: string): Response {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (cookie) headers.set("Set-Cookie", cookie);
  return Response.json(body, { status, headers });
}

export const Route = createFileRoute("/api/auth")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const identity = readSessionFromRequest(request);
          if (!identity) return apiError("authentication_required", 401);
          return noStoreJson({ email: identity.email, expiresAt: identity.expiresAt });
        } catch {
          return unavailable();
        }
      },
      POST: async ({ request }) => {
        const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
        if (mediaType !== "application/json") return apiError("content_type_must_be_application_json", 415);
        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (Number.isFinite(contentLength) && contentLength > 8192) return apiError("credentials_too_large", 413);
        let body: unknown;
        try { body = await request.json(); } catch { return apiError("invalid_json", 400); }
        if (!body || typeof body !== "object" || Array.isArray(body)) return apiError("invalid_credentials", 400);
        const credentials = body as Record<string, unknown>;
        if (
          typeof credentials.email !== "string" ||
          typeof credentials.password !== "string" ||
          credentials.password.length < 1 ||
          credentials.password.length > 1024
        ) return apiError("invalid_credentials", 400);

        try {
          const config = getAuthConfig(process.env);
          const passwordMatches = verifyPassword(credentials.password, config.passwordHash);
          const emailMatches = credentials.email.trim().toLowerCase() === config.adminEmail;
          if (!passwordMatches || !emailMatches) return apiError("invalid_credentials", 401);
          const token = createSessionToken(config.adminEmail, config.sessionSecret);
          return noStoreJson({ email: config.adminEmail }, 200, sessionCookie(token, request));
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("PID_")) return unavailable();
          return apiError("authentication_unavailable", 503);
        }
      },
      DELETE: async ({ request }) =>
        noStoreJson({ signedOut: true }, 200, clearedSessionCookie(request)),
    },
  },
});
