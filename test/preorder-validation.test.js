import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateOptionalQty,
  validateCoverDays,
} from "../app/lib/preorder-validation.js";

test("validateOptionalQty accepts blank as null", () => {
  assert.deepEqual(validateOptionalQty(null), { ok: true, value: null });
  assert.deepEqual(validateOptionalQty(undefined), { ok: true, value: null });
  assert.deepEqual(validateOptionalQty(""), { ok: true, value: null });
  assert.deepEqual(validateOptionalQty("  "), { ok: true, value: null });
});

test("validateOptionalQty accepts integers from 0 to 2147483647", () => {
  assert.deepEqual(validateOptionalQty(0), { ok: true, value: 0 });
  assert.deepEqual(validateOptionalQty("0"), { ok: true, value: 0 });
  assert.deepEqual(validateOptionalQty(42), { ok: true, value: 42 });
  assert.deepEqual(validateOptionalQty("42"), { ok: true, value: 42 });
  assert.deepEqual(validateOptionalQty(2147483647), {
    ok: true,
    value: 2147483647,
  });
  assert.deepEqual(validateOptionalQty("2147483647"), {
    ok: true,
    value: 2147483647,
  });
});

test("validateOptionalQty rejects decimals instead of truncating", () => {
  const out = validateOptionalQty("3.5");
  assert.equal(out.ok, false);
  assert.match(out.error, /whole number/i);
  assert.doesNotMatch(out.error, /prisma|database|int4|connector/i);
});

test("validateOptionalQty rejects overflow and negatives", () => {
  const overflow = validateOptionalQty("2147483648");
  assert.equal(overflow.ok, false);
  assert.match(overflow.error, /0 to 2,147,483,647/i);
  assert.doesNotMatch(overflow.error, /prisma|database|int4|connector/i);

  const negative = validateOptionalQty("-1");
  assert.equal(negative.ok, false);

  const junk = validateOptionalQty("abc");
  assert.equal(junk.ok, false);
});

test("validateCoverDays accepts valid hysteresis pair", () => {
  assert.deepEqual(validateCoverDays(3, 7), {
    ok: true,
    switchOnCoverDays: 3,
    switchOffCoverDays: 7,
  });
  assert.deepEqual(validateCoverDays("3", "7"), {
    ok: true,
    switchOnCoverDays: 3,
    switchOffCoverDays: 7,
  });
  assert.deepEqual(validateCoverDays(0, 1), {
    ok: true,
    switchOnCoverDays: 0,
    switchOffCoverDays: 1,
  });
  assert.deepEqual(validateCoverDays(364, 365), {
    ok: true,
    switchOnCoverDays: 364,
    switchOffCoverDays: 365,
  });
});

test("validateCoverDays rejects decimals instead of truncating", () => {
  const out = validateCoverDays("3.5", "7");
  assert.equal(out.ok, false);
  assert.match(out.error, /whole numbers from 0 to 365/i);
  assert.doesNotMatch(out.error, /prisma|database/i);

  const offDecimal = validateCoverDays(3, 7.5);
  assert.equal(offDecimal.ok, false);
});

test("validateCoverDays rejects out of range and bad hysteresis", () => {
  assert.equal(validateCoverDays(3, 3).ok, false);
  assert.equal(validateCoverDays(7, 3).ok, false);
  assert.match(validateCoverDays(7, 3).error, /greater than/i);

  assert.equal(validateCoverDays(-1, 7).ok, false);
  assert.equal(validateCoverDays(3, 366).ok, false);
  assert.equal(validateCoverDays("", 7).ok, false);
  assert.equal(validateCoverDays("abc", "7").ok, false);

  const err = validateCoverDays(3, 366).error;
  assert.doesNotMatch(err, /prisma|database|int4|connector/i);
});
