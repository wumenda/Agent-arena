import { test } from "node:test";
import assert from "node:assert/strict";
import { countWords } from "../src/countWords.js";

test("大小写归一为小写", () => {
  assert.deepEqual(countWords("Hello hello HELLO"), { hello: 3 });
});

test("连续空白与制表符都按分隔处理", () => {
  assert.deepEqual(countWords("a  b\t c"), { a: 1, b: 1, c: 1 });
});

test("标点视为分隔符", () => {
  assert.deepEqual(countWords("hi,hi!hi?"), { hi: 3 });
});

test("混合文本统计正确", () => {
  assert.deepEqual(countWords("To be, or not to be."), { to: 2, be: 2, or: 1, not: 1 });
});
