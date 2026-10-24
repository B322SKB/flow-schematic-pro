import { describe, expect, it } from "vitest";
import { upgradeSchemeEntityIds } from "./cad-identity";
import type { Scheme } from "./types";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function fixture(): Scheme {
  return {
    id: "project-1",
    name: "PoC",
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

describe("upgradeSchemeEntityIds", () => {
  it("upgrades node and pipe ids and rewrites both pipe endpoints", () => {
    let next = 1;
    const result = upgradeSchemeEntityIds(fixture(), () => uuid(next++));
    expect(result.nodeIdsChanged).toBe(2);
    expect(result.pipeIdsChanged).toBe(1);
    expect(result.scheme.nodes.map((n) => n.id)).toEqual([uuid(1), uuid(2)]);
    expect(result.scheme.pipes[0]).toMatchObject({
      id: uuid(3),
      from: { node: uuid(1), port: "c" },
      to: { node: uuid(2), port: "a" },
    });
  });

  it("is idempotent for UUIDv4 identities", () => {
    const first = upgradeSchemeEntityIds(fixture(), (() => {
      let n = 1;
      return () => uuid(n++);
    })());
    const second = upgradeSchemeEntityIds(first.scheme, () => {
      throw new Error("factory must not be called for existing UUIDs");
    });
    expect(second.changed).toBe(false);
    expect(second.scheme).toEqual(first.scheme);
  });

  it("rejects dangling pipe endpoints rather than silently breaking topology", () => {
    const scheme = fixture();
    scheme.pipes[0]!.to.node = "missing";
    expect(() => upgradeSchemeEntityIds(scheme, () => uuid(1))).toThrow(/missing node/);
  });

  it("rejects duplicate node ids", () => {
    const scheme = fixture();
    scheme.nodes[1]!.id = "n1";
    expect(() => upgradeSchemeEntityIds(scheme, () => uuid(1))).toThrow(/Duplicate/);
  });
});
