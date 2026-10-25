import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "pid_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 310_000;
const PASSWORD_BYTES = 32;

export interface AuthConfig {
  adminEmail: string;
  passwordHash: string;
  sessionSecret: string;
}

export interface SessionIdentity {
  email: string;
  expiresAt: number;
}

function decodePasswordHash(encoded: string): { iterations: number; salt: Buffer; digest: Buffer } | null {
  const match = /^pbkdf2\$(\d{6})\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(encoded);
  if (!match) return null;
  const iterations = Number(match[1]);
  const salt = Buffer.from(match[2]!, "base64url");
  const digest = Buffer.from(match[3]!, "base64url");
  if (iterations < 100_000 || iterations > 1_000_000 || salt.length < 16 || salt.length > 32 ||
      digest.length !== PASSWORD_BYTES || salt.toString("base64url") !== match[2] ||
      digest.toString("base64url") !== match[3]) return null;
  return { iterations, salt, digest };
}

export function getAuthConfig(env: Record<string, string | undefined>): AuthConfig {
  const email = env.PID_ADMIN_EMAIL?.trim().toLowerCase();
  const passwordHash = env.PID_ADMIN_PASSWORD_HASH?.trim();
  const sessionSecret = env.PID_SESSION_SECRET ?? "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("PID_ADMIN_EMAIL must be a valid email address");
  }
  if (!passwordHash || !decodePasswordHash(passwordHash)) {
    throw new Error("PID_ADMIN_PASSWORD_HASH must be a valid PBKDF2-SHA256 password hash");
  }
  if (Buffer.byteLength(sessionSecret, "utf8") < 32) {
    throw new Error("PID_SESSION_SECRET must contain at least 32 bytes");
  }
  return { adminEmail: email, passwordHash, sessionSecret };
}

export function hashPassword(password: string, salt = randomBytes(16)): string {
  const derived = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_BYTES, "sha256");
  return "pbkdf2$" + PASSWORD_ITERATIONS + "$" + salt.toString("base64url") + "$" + derived.toString("base64url");
}

export function verifyPassword(password: string, encoded: string): boolean {
  const parsed = decodePasswordHash(encoded);
  if (!parsed) return false;
  const actual = pbkdf2Sync(password, parsed.salt, parsed.iterations, parsed.digest.length, "sha256");
  return timingSafeEqual(actual, parsed.digest);
}

export function createSessionToken(email: string, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({
    email: email.trim().toLowerCase(),
    expiresAt: now + SESSION_TTL_MS,
  }), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return payload + "." + signature;
}

export function readSessionToken(token: string, secret: string, now = Date.now()): SessionIdentity | null {
  if (token.length > 2048) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof value.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) ||
        typeof value.expiresAt !== "number" || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now) return null;
    return { email: value.email, expiresAt: value.expiresAt };
  } catch {
    return null;
  }
}

export function readSessionFromRequest(request: Request): SessionIdentity | null {
  const config = getAuthConfig(process.env);
  const cookies = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim())
    .filter((part) => part.startsWith(SESSION_COOKIE_NAME + "="));
  if (cookies.length !== 1) return null;
  return readSessionToken(cookies[0]!.slice(SESSION_COOKIE_NAME.length + 1), config.sessionSecret);
}

export function sessionCookie(token: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return SESSION_COOKIE_NAME + "=" + token + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" +
    String(SESSION_TTL_MS / 1000) + secure;
}

export function clearedSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return SESSION_COOKIE_NAME + "=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" + secure;
}
