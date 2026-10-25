import assert from "node:assert/strict";

const baseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:3000";
const ready = await fetch(new URL("/api/ready", baseUrl));
assert.equal(ready.status, 200, "database readiness endpoint must report ready");
assert.equal((await ready.json()).storage, "postgres");

const dto = {
  formatVersion: 1,
  scheme: {
    id: "00000000-0000-4000-8000-000000000101",
    name: "API smoke drawing",
    nodes: [],
    pipes: [],
    fluid: "water",
    concentration: 0,
    temperature: 10,
    deltaT: 5,
    circuitColors: {},
    customSymbols: [],
    revision: "R00",
    updatedAt: 1761370000000,
    schemaVersion: 4,
  },
};

const createdResponse = await fetch(new URL("/api/drawings", baseUrl), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(dto),
});
assert.equal(createdResponse.status, 201, "a valid snapshot must create a drawing");
const created = await createdResponse.json();
assert.match(created.drawingId, /^[0-9a-f-]{36}$/i);
assert.equal(created.revisionNo, 1);
assert.deepEqual(created.snapshot, dto);

const url = new URL(`/api/drawings/${created.drawingId}`, baseUrl);
const readResponse = await fetch(url);
assert.equal(readResponse.status, 200);
assert.equal(readResponse.headers.get("etag"), '"1"');
assert.deepEqual((await readResponse.json()).snapshot, dto);

const updatedDto = structuredClone(dto);
updatedDto.scheme.name = "API smoke drawing updated";
const update = await fetch(url, {
  method: "PUT",
  headers: { "content-type": "application/json", "if-match": '"1"' },
  body: JSON.stringify(updatedDto),
});
assert.equal(update.status, 200, "a current base revision must be accepted");
assert.equal(update.headers.get("etag"), '"2"');
assert.equal((await update.json()).revisionNo, 2);

const stale = await fetch(url, {
  method: "PUT",
  headers: { "content-type": "application/json", "if-match": '"1"' },
  body: JSON.stringify(dto),
});
assert.equal(stale.status, 409, "a stale base revision must be rejected");
const finalRead = await fetch(url);
assert.equal(finalRead.headers.get("etag"), '"2"');
assert.equal((await finalRead.json()).snapshot.scheme.name, "API smoke drawing updated");

const invalid = await fetch(new URL("/api/drawings", baseUrl), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ formatVersion: 9 }),
});
assert.equal(invalid.status, 400, "unsupported snapshot DTO versions must be rejected");

console.log("PostgreSQL drawing API smoke checks passed.");
