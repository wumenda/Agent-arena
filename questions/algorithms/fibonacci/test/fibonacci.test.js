import { test } from "node:test";
import assert from "node:assert/strict";
import { fib } from "../src/fibonacci.js";

test("边界：fib(1) 与 fib(2) 都是 1", () => {
  assert.equal(fib(1), 1);
  assert.equal(fib(2), 1);
});

test("fib(10) = 55", () => {
  assert.equal(fib(10), 55);
});

test("fib(20) = 6765", () => {
  assert.equal(fib(20), 6765);
});
