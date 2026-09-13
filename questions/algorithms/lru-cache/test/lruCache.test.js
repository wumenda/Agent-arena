import { test } from "node:test";
import assert from "node:assert/strict";
import { LRUCache } from "../src/lruCache.js";

test("get 命中刷新新鲜度，淘汰的是最久未使用的键", () => {
  const c = new LRUCache(2);
  c.set("a", 1);
  c.set("b", 2);
  assert.equal(c.get("a"), 1); // a 变为最新
  c.set("c", 3); // 应淘汰 b
  assert.equal(c.has("a"), true);
  assert.equal(c.has("b"), false);
  assert.equal(c.get("c"), 3);
});

test("重复 set 已存在的键也算一次使用", () => {
  const c = new LRUCache(2);
  c.set("a", 1);
  c.set("b", 2);
  c.set("a", 9);
  c.set("c", 3); // 应淘汰 b
  assert.equal(c.get("a"), 9);
  assert.equal(c.has("b"), false);
});

test("容量内不误淘汰", () => {
  const c = new LRUCache(3);
  c.set("a", 1);
  c.set("b", 2);
  c.set("c", 3);
  assert.equal(c.get("a"), 1);
  assert.equal(c.get("b"), 2);
  assert.equal(c.get("c"), 3);
});

test("容量非法直接抛 RangeError", () => {
  assert.throws(() => new LRUCache(0), RangeError);
});
