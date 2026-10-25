import { describe, expect, it } from "vitest";
import { migratePersistedPidState, upgradePersistedProjectIdentities } from "./persisted-identity";
import type { KeyValueStorage } from "./persisted-backup";
import type { Scheme } from "./types";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function project(id: string): Scheme {
  return {
    id,
    name: id,
    nodes: [
      { id: "n1", type: "chiller", tag: "CH-01", x: 0, y: 0, rotation: 0 },
      { id: "n2", type: "pump_inline", tag: "P-01", x: 100, y: 0, rotation: 0 },
    ],
    pipes: [{
      id: "p1", tag: "L-01",
      from: { node: "n1", port: "c" }, to: { node: "n2", port: "a" },
      dn: 80, material: "steel_carbon", joint: "grooved", circuit: "supply",
      length: 2.5, flow: 10, flowMode: "manual", routing: "auto", fittings: {},
    }],
    fluid: "water", concentration: 0, temperature: 10, deltaT: 5,
    circuitColors: {}, customSymbols: [], revision: "R00", updatedAt: 1,
  };
}

describe("upgradePersistedProjectIdentities", () => {
  it("upgrades valid projects while retaining an invalid project", () => {
    const firstProject = project("good-1");
    const secondProject = project("good-2");
    const broken = { id: "broken", nodes: [], pipes: [{ id: "p", from: { node: "missing" }, to: { node: "missing" } }] };
    let next = 1;
    const result = upgradePersistedProjectIdentities(
      { activeId: "good-1", projects: [firstProject, broken, secondProject] },
      () => uuid(next++),
    );

    expect(result.migratedProjectIds).toEqual(["good-1", "good-2"]);
    expect(result.failedProjects).toHaveLength(1);
    expect(result.failedProjects[0]).toMatchObject({ index: 1, projectId: "broken" });
    expect(result.state.projects[1]).toBe(broken);
    expect(result.state.projects[0]).not.toBe(firstProject);
    expect(result.state.projects[2]).not.toBe(secondProject);
    expect(result.state.activeId).toBe("good-1");
  });


  it("backs up raw storage before upgrading persisted project IDs", () => {
    const rawStorage = '{"state":{"projects":[{"id":"legacy"}]},"version":3}';
    const storage: KeyValueStorage & { values: Map<string, string> } = {
      values: new Map([["pid-studio-v2", rawStorage]]),
      getItem(key) { return this.values.get(key) ?? null; },
      setItem(key, value) { this.values.set(key, value); },
    };
    let next = 1;
    const result = migratePersistedPidState(
      { projects: [project("legacy-project")] },
      storage,
      "pid-studio-v2",
      () => uuid(next++),
    );
    expect(result.backup.created).toBe(true);
    expect(storage.getItem("pid-studio-v2:pre-migration-backup")).toBe(rawStorage);
    expect(storage.getItem("pid-studio-v2")).toBe(rawStorage);
    expect(result.state.projects[0]!.nodes[0]!.id).toBe(uuid(1));
  });

  it("aborts migration when the raw persisted value cannot be backed up", () => {
    const storage: KeyValueStorage = {
      getItem: () => "original",
      setItem: () => { throw new Error("quota exceeded"); },
    };
    expect(() => migratePersistedPidState(
      { projects: [project("legacy-project")] },
      storage,
      "pid-studio-v2",
      () => uuid(1),
    )).toThrow(/quota exceeded/);
  });

  it("aborts migration when the original persisted value is missing", () => {
    const storage: KeyValueStorage = {
      getItem: () => null,
      setItem: () => undefined,
    };
    expect(() => migratePersistedPidState(
      { projects: [project("legacy-project")] },
      storage,
      "pid-studio-v2",
      () => uuid(1),
    )).toThrow(/source storage value is missing/);
  });

  it("does not mutate the original persisted state", () => {
    const originalProject = project("p1");
    const original = { projects: [originalProject] };
    const originalNodeId = originalProject.nodes[0]!.id;
    let next = 1;
    const result = upgradePersistedProjectIdentities(original, () => uuid(next++));
    expect(original.projects[0]!.nodes[0]!.id).toBe(originalNodeId);
    expect(result.state.projects[0]).not.toBe(originalProject);
    expect(result.state.projects[0]!.nodes[0]!.id).toBe(uuid(1));
  });

  it("leaves projects without a projects array untouched", () => {
    const state = { activeId: "x" };
    const result = upgradePersistedProjectIdentities(state);
    expect(result.state).toBe(state);
    expect(result.migratedProjectIds).toEqual([]);
    expect(result.failedProjects).toEqual([]);
  });

  it("does not call the ID factory for an empty project collection", () => {
    const result = upgradePersistedProjectIdentities({ projects: [] }, () => {
      throw new Error("factory should not run");
    });
    expect(result.state.projects).toEqual([]);
    expect(result.failedProjects).toEqual([]);
  });
});
