import { apiError } from "./api-http";
import { readSessionFromRequest } from "./auth";

export function requireDrawingSession(request: Request): string | Response {
  try {
    const identity = readSessionFromRequest(request);
    return identity?.email ?? apiError("authentication_required", 401);
  } catch {
    return apiError("authentication_not_configured", 503);
  }
}
