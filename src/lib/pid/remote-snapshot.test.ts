import { afterEach, describe, expect, it } from "vitest";
import { buildTemplate, usePid } from "./store";

describe("remote drawing snapshots", () => {
  const original = usePid.getState();

  afterEach(() => {
    usePid.setState(original, true);
  });

  it("replaces the active snapshot while retaining the browser project's local identity and undo", () => {
    const localId = usePid.getState().scheme.id;
    const remote = buildTemplate("empty", "Server copy");
    remote.id = "22222222-2222-4222-8222-222222222222";

    usePid.getState().replaceSchemeSnapshot(remote);

    expect(usePid.getState().scheme).toMatchObject({ id: localId, name: "Server copy" });
    expect(usePid.getState().projects.find((project) => project.id === localId)?.name).toBe("Server copy");
    expect(usePid.getState().undo()).toBe(true);
    expect(usePid.getState().scheme.id).toBe(localId);
    expect(usePid.getState().scheme.name).not.toBe("Server copy");
  });
});
