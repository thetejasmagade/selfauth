import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { createApp } from "../src/app.ts";

let base = "";
let close = () => {};
before(async () => {
  const server = (await createApp()).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
after(() => close());

test("health", async () => {
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true });
});

test("lists products publicly", async () => {
  const res = await fetch(`${base}/api/products`);
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { products: unknown[] }).products.length, 2);
});

test("unknown product is 404", async () => {
  assert.equal((await fetch(`${base}/api/products/nope`)).status, 404);
});
