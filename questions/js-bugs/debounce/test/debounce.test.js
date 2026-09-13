import { test } from "node:test";
import assert from "node:assert/strict";
import { debounce } from "../src/debounce.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("连续调用只触发一次", async () => {
  let calls = 0;
  const bump = debounce(() => { calls += 1; }, 100);
  bump(); bump(); bump();
  await sleep(250);
  assert.equal(calls, 1);
});

test("等待期内再次调用重新计时，只执行最后一次的参数", async () => {
  const seen = [];
  const push = debounce((v) => seen.push(v), 100);
  push("a");
  await sleep(50);
  push("b");
  await sleep(250);
  assert.deepEqual(seen, ["b"]);
});

test("正确保留 this", async () => {
  let ctx = null;
  const probe = debounce(function () { ctx = this; }, 50);
  const obj = { probe };
  obj.probe();
  await sleep(150);
  assert.equal(ctx, obj);
});
