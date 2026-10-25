import { describe, expect, it } from "vitest";
import { upgradePersistedProjectIdentities } from "./persisted-identity";
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
    const broken = { id: "broken", nodes: [], pipes: [{ id: "p", from: { node: "missing" }, to: { node: "missing" } }] };
    let next = 1;
    const result = upgradePersistedProjectIdentities(
      { activeId: "good-1", projects: [project("good-1"), broken, project("good-2")] },
      () => uuid(next++),
    );

    expect(result.migratedProjectIds).toEqual(["good-1", "good-2"]);
    expect(result.failedProjects).toHaveLength(1);
    expect(result.failedProjects[0]).toMatchObject({ index: 1, projectId: "broken" });
    expect(result.state.projects[1]).toBe(broken);
    expect(result.state.projects[0]).not.toBe(project("good-1"));
    expect(result.state.activeId).toBe("good-1");
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
