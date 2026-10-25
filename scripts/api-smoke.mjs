import assert from "node:assert/strict";

const baseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:3000";
const ready = await fetch(new URL("/api/ready", baseUrl));
assert.equal(ready.status, 200, "database readiness endpoint must report ready");
assert.equal((await ready.json()).storage, "postgres");

const anonymous = await fetch(new URL("/api/drawings", baseUrl), { method: "POST" });
assert.equal(anonymous.status, 401, "drawing API must reject anonymous requests");

const login = await fetch(new URL("/api/auth", baseUrl), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "admin@pid.local", password: "pid-test-password" }),
});
assert.equal(login.status, 200, "configured administrator credentials must create a session");
const setCookie = login.headers.get("set-cookie");
assert.ok(setCookie?.startsWith("pid_session="), "login must set a session cookie");
const cookie = setCookie.split(";", 1)[0];
const session = await fetch(new URL("/api/auth", baseUrl), { headers: { cookie } });
assert.equal(session.status, 200);
assert.equal((await session.json()).email, "admin@pid.local");

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
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify(dto),
});
assert.equal(createdResponse.status, 201);
const created = await createdResponse.json();
assert.match(created.drawingId, /^[0-9a-f-]{36}$/i);
assert.equal(created.revisionNo, 1);
assert.deepEqual(created.snapshot, dto);

const url = new URL("/api/drawings/" + created.drawingId, baseUrl);
const readResponse = await fetch(url, { headers: { cookie } });
assert.equal(readResponse.status, 200);
assert.equal(readResponse.headers.get("etag"), '"1"');
assert.deepEqual((await readResponse.json()).snapshot, dto);

const updatedDto = structuredClone(dto);
updatedDto.scheme.name = "API smoke drawing updated";
const update = await fetch(url, {
  method: "PUT",
  headers: { "content-type": "application/json", "if-match": '"1"', cookie },
  body: JSON.stringify(updatedDto),
});
assert.equal(update.status, 200);
assert.equal(update.headers.get("etag"), '"2"');
assert.equal((await update.json()).revisionNo, 2);

const stale = await fetch(url, {
  method: "PUT",
  headers: { "content-type": "application/json", "if-match": '"1"', cookie },
  body: JSON.stringify(dto),
});
assert.equal(stale.status, 409);
const finalRead = await fetch(url, { headers: { cookie } });
assert.equal(finalRead.headers.get("etag"), '"2"');
assert.equal((await finalRead.json()).snapshot.scheme.name, "API smoke drawing updated");

const invalid = await fetch(new URL("/api/drawings", baseUrl), {
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({ formatVersion: 9 }),
});
assert.equal(invalid.status, 400);

const logout = await fetch(new URL("/api/auth", baseUrl), { method: "DELETE", headers: { cookie } });
assert.equal(logout.status, 200);
const clearedCookie = logout.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
const revoked = await fetch(url, { headers: { cookie: clearedCookie } });
assert.equal(revoked.status, 401, "cleared cookie must not authorize drawing access");

console.log("Authenticated PostgreSQL drawing API smoke checks passed.");
