import { describe, expect, it } from "vitest";
import { parseSchemeSnapshotDto, serializeSchemeSnapshot } from "./api-dto";
import type { Scheme } from "./types";

const scheme: Scheme = {
  id: "drawing-1",
  name: "Pilot",
  nodes: [{ id: "node-1", type: "chiller", tag: "CH-01", x: 10, y: 20, rotation: 0 }],
  pipes: [{
    id: "pipe-1",
    tag: "L-01",
    from: { node: "node-1", port: "c" },
    to: { node: "node-1", port: "r" },
    dn: 50,
    material: "steel_carbon",
    joint: "grooved",
    circuit: "supply",
    length: 2,
    flow: 1.5,
    flowMode: "manual",
    routing: "hv",
    points: [{ x: 11, y: 12 }],
    fittings: { elbow_90: 2 },
  }],
  fluid: "water",
  concentration: 0,
  temperature: 10,
  deltaT: 5,
  circuitColors: { supply: "#ff0000" },
  customSymbols: [],
  revision: "R01",
  updatedAt: 1_761_370_000_000,
  schemaVersion: 4,
  layers: { pipes: { visible: true, locked: false } },
};

describe("P&ID API snapshot DTO", () => {
  it("wraps the current Scheme as a versioned drawing snapshot without losing model data", () => {
    const dto = serializeSchemeSnapshot(scheme);

    expect(dto.formatVersion).toBe(1);
    expect(dto.scheme).toEqual(scheme);
    expect(parseSchemeSnapshotDto(JSON.parse(JSON.stringify(dto)))).toEqual(dto);
  });

  it("rejects unsupported DTO versions and malformed Scheme snapshots", () => {
    expect(() => parseSchemeSnapshotDto({ formatVersion: 2, scheme })).toThrow(/format version/i);
    expect(() => parseSchemeSnapshotDto({ formatVersion: 1, scheme: { ...scheme, pipes: null } })).toThrow(/scheme snapshot/i);
  });
});
