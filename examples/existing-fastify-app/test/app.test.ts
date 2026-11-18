import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/app.ts";

let app: FastifyInstance;
before(async () => {
  app = await createApp();
  await app.ready();
});
after(() => app.close());

test("health", async () => {
  assert.deepEqual((await app.inject("/health")).json(), { ok: true });
});

test("lists products publicly", async () => {
  const res = await app.inject("/api/products");
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().products.length, 2);
});

test("unknown product is 404", async () => {
  assert.equal((await app.inject("/api/products/nope")).statusCode, 404);
});
