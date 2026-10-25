import { describe, expect, it, vi } from "vitest";
import type { Scheme } from "./types";
import {
  createRemoteDrawing,
  getRemoteSession,
  loadRemoteDrawing,
  loginRemoteApi,
  logoutRemoteApi,
  saveRemoteDrawing,
} from "./remote-api";

const scheme: Scheme = {
  id: "local-id",
  name: "Pilot",
  nodes: [],
  pipes: [],
  fluid: "water",
  concentration: 0,
  temperature: 10,
  deltaT: 5,
  circuitColors: {},
  customSymbols: [],
  revision: "R00",
  updatedAt: 1_761_370_000_000,
};

describe("authenticated P&ID remote API client", () => {
  it("sends same-origin credentials to sign in and read the current session", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ email: "admin@pid.local" }))
      .mockResolvedValueOnce(Response.json({ email: "admin@pid.local", expiresAt: 10_000 }));
    await loginRemoteApi("admin@pid.local", "secret", fetcher);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/auth");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ "content-type": "application/json" });
    expect(await getRemoteSession(fetcher)).toEqual({ email: "admin@pid.local", expiresAt: 10_000 });
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: "GET", credentials: "same-origin" });
  });

  it("returns null for an expired sign-in and throws on other session failures", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: "authentication_required" }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ error: "database_unavailable" }, { status: 503 }));
    expect(await getRemoteSession(fetcher)).toBeNull();
    await expect(getRemoteSession(fetcher)).rejects.toThrow(/database_unavailable/);
  });

  it("creates a drawing snapshot and validates the response contract", async () => {
    const response = {
      drawingId: "11111111-1111-4111-8111-111111111111",
      revisionNo: 1,
      snapshot: { formatVersion: 1, scheme },
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(response, { status: 201 }));
    expect(await createRemoteDrawing(scheme, fetcher)).toEqual(response);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ formatVersion: 1, scheme });
  });

  it("loads ETag revision and sends it with optimistic updates", async () => {
    const current = {
      drawingId: "11111111-1111-4111-8111-111111111111",
      revisionNo: 2,
      snapshot: { formatVersion: 1, scheme },
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(current, { headers: { ETag: '"2"' } }))
      .mockResolvedValueOnce(Response.json({ ...current, revisionNo: 3 }, { headers: { ETag: '"3"' } }));
    expect(await loadRemoteDrawing(current.drawingId, fetcher)).toEqual(current);
    const updated = await saveRemoteDrawing(current.drawingId, 2, scheme, fetcher);
    expect(updated.revisionNo).toBe(3);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "if-match": '"2"' },
    });
  });

  it("surfaces stale revision conflicts and signs out through the API", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: "revision_conflict" }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ signedOut: true }));
    await expect(saveRemoteDrawing("11111111-1111-4111-8111-111111111111", 1, scheme, fetcher))
      .rejects.toThrow(/revision_conflict/);
    expect(await logoutRemoteApi(fetcher)).toEqual({ signedOut: true });
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE", credentials: "same-origin" });
  });
});
