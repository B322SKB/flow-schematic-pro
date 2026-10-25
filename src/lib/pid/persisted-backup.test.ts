import { describe, expect, it } from "vitest";
import { backupPersistedValue, restorePersistedValue, type KeyValueStorage } from "./persisted-backup";

class MemoryStorage implements KeyValueStorage {
  values = new Map<string, string>();
  failWrites = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("quota exceeded");
    this.values.set(key, value);
  }
}

describe("persisted backup", () => {
  it("backs up the exact raw value without changing the source", () => {
    const storage = new MemoryStorage();
    const raw = '{"version":3,"projects":[{"id":"legacy"}]}';
    storage.setItem("pid-store", raw);
    const result = backupPersistedValue(storage, "pid-store");
    expect(result).toMatchObject({ created: true, hadSourceValue: true });
    expect(storage.getItem("pid-store")).toBe(raw);
    expect(storage.getItem("pid-store:pre-migration-backup")).toBe(raw);
  });

  it("reuses an identical backup idempotently", () => {
    const storage = new MemoryStorage();
    storage.setItem("pid-store", "payload");
    expect(backupPersistedValue(storage, "pid-store").created).toBe(true);
    expect(backupPersistedValue(storage, "pid-store").created).toBe(false);
  });

  it("refuses to overwrite a different existing backup", () => {
    const storage = new MemoryStorage();
    storage.setItem("pid-store", "new");
    storage.setItem("pid-store:pre-migration-backup", "old-backup");
    expect(() => backupPersistedValue(storage, "pid-store")).toThrow(/different content/);
    expect(storage.getItem("pid-store")).toBe("new");
    expect(storage.getItem("pid-store:pre-migration-backup")).toBe("old-backup");
  });

  it("fails closed when backup storage cannot be written", () => {
    const storage = new MemoryStorage();
    storage.setItem("pid-store", "payload");
    storage.failWrites = true;
    expect(() => backupPersistedValue(storage, "pid-store")).toThrow(/quota exceeded/);
    expect(storage.getItem("pid-store")).toBe("payload");
  });

  it("reports missing source without creating an empty backup", () => {
    const storage = new MemoryStorage();
    expect(backupPersistedValue(storage, "pid-store")).toMatchObject({
      created: false, hadSourceValue: false,
    });
    expect(storage.getItem("pid-store:pre-migration-backup")).toBeNull();
  });

  it("restores the exact backup and verifies the restored value", () => {
    const storage = new MemoryStorage();
    storage.setItem("pid-store", "before");
    backupPersistedValue(storage, "pid-store");
    storage.setItem("pid-store", "after");
    restorePersistedValue(storage, "pid-store");
    expect(storage.getItem("pid-store")).toBe("before");
  });

  it("refuses restoration when no backup exists", () => {
    const storage = new MemoryStorage();
    expect(() => restorePersistedValue(storage, "pid-store")).toThrow(/not found/);
  });
});
