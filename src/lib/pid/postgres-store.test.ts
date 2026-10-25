import { describe, expect, it } from "vitest";
import { getPostgresConfig } from "./postgres-store";

describe("getPostgresConfig", () => {
  it("requires explicit connection settings and does not echo secret values", () => {
    expect(() => getPostgresConfig({ PGHOST: "db", PGPASSWORD: "secret" } as NodeJS.ProcessEnv))
      .toThrow(/PGDATABASE.*PGUSER/);
  });

  it("reads connection fields and defaults to PostgreSQL's standard port", () => {
    expect(getPostgresConfig({
      PGHOST: "db",
      PGDATABASE: "pid",
      PGUSER: "pid_app",
      PGPASSWORD: "local-test-secret",
    } as NodeJS.ProcessEnv)).toEqual({
      host: "db",
      port: 5432,
      database: "pid",
      user: "pid_app",
      password: "local-test-secret",
    });
  });

  it("rejects malformed ports", () => {
    expect(() => getPostgresConfig({
      PGHOST: "db",
      PGDATABASE: "pid",
      PGUSER: "pid_app",
      PGPASSWORD: "local-test-secret",
      PGPORT: "5432; drop database pid",
    } as NodeJS.ProcessEnv)).toThrow(/PGPORT/);
  });
});
