import { describe, expect, it } from "vitest";
import { buildTemplate } from "./store";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("persistent P&ID identities", () => {
  it.each(["empty", "demo", "ring_dc"] as const)(
    "creates UUIDv4 identities for the %s template",
    (template) => {
      const scheme = buildTemplate(template);
      expect(scheme.id).toMatch(UUID_V4);
      for (const node of scheme.nodes) expect(node.id).toMatch(UUID_V4);
      for (const pipe of scheme.pipes) {
        expect(pipe.id).toMatch(UUID_V4);
        expect(scheme.nodes.some((node) => node.id === pipe.from.node)).toBe(true);
        expect(scheme.nodes.some((node) => node.id === pipe.to.node)).toBe(true);
      }
    },
  );
});
