import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  getAuthConfig,
  hashPassword,
  readSessionToken,
  verifyPassword,
} from "./auth";

describe("P&ID on-prem authentication", () => {
  it("requires an administrator email, password hash, and long session secret", () => {
    expect(() => getAuthConfig({})).toThrow(/PID_ADMIN_EMAIL/);
    expect(() => getAuthConfig({
      PID_ADMIN_EMAIL: "admin@example.test",
      PID_ADMIN_PASSWORD_HASH: "invalid",
      PID_SESSION_SECRET: "short",
    })).toThrow(/PID_ADMIN_PASSWORD_HASH/);
    expect(() => getAuthConfig({
      PID_ADMIN_EMAIL: "admin@example.test",
      PID_ADMIN_PASSWORD_HASH: "pbkdf2$310000$ABEiM0RVZneImaq7zN3u_w$u9SUEGrpYENvHdgsxf2H52HfhQkqCjau5TCFF5VOeQw",
      PID_SESSION_SECRET: "short",
    })).toThrow(/PID_SESSION_SECRET/);
  });

  it("normalizes the configured administrator email", () => {
    const config = getAuthConfig({
      PID_ADMIN_EMAIL: " Admin@Example.Test ",
      PID_ADMIN_PASSWORD_HASH: "pbkdf2$310000$ABEiM0RVZneImaq7zN3u_w$u9SUEGrpYENvHdgsxf2H52HfhQkqCjau5TCFF5VOeQw",
      PID_SESSION_SECRET: "a".repeat(32),
    });
    expect(config.adminEmail).toBe("admin@example.test");
  });

  it("hashes and verifies passwords without accepting malformed hashes", () => {
    const hash = hashPassword("a strong test password", Buffer.from("00112233445566778899aabbccddeeff", "hex"));
    expect(hash).toMatch(/^pbkdf2\$310000\$/);
    expect(verifyPassword("a strong test password", hash)).toBe(true);
    expect(verifyPassword("a different password", hash)).toBe(false);
    expect(verifyPassword("a strong test password", "not-a-hash")).toBe(false);
  });

  it("accepts signed sessions until expiry and rejects tampering or another secret", () => {
    const secret = "s".repeat(32);
    const token = createSessionToken("admin@example.test", secret, 1_000);
    expect(readSessionToken(token, secret, 1_001)).toEqual({
      email: "admin@example.test",
      expiresAt: 1_000 + 8 * 60 * 60 * 1000,
    });
    expect(readSessionToken(token + "x", secret, 1_001)).toBeNull();
    expect(readSessionToken(token, "t".repeat(32), 1_001)).toBeNull();
    expect(readSessionToken(token, secret, 1_000 + 8 * 60 * 60 * 1000)).toBeNull();
  });
});
