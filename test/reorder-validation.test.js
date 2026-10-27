import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateSupplierName,
  validateOptionalNotes,
  validateLeadTimeDays,
  validateOptionalLeadTimeDays,
  validateOptionalPositiveInt,
  validateOptionalUnitCost,
  validateSku,
  validateReorderDefaults,
  validateSupplierId,
} from "../app/lib/reorder-validation.js";

test("validateSupplierName requires a trimmed name", () => {
  assert.equal(validateSupplierName("").ok, false);
  assert.equal(validateSupplierName("   ").ok, false);
  assert.deepEqual(validateSupplierName("  Acme  "), {
    ok: true,
    value: "Acme",
  });
});

test("validateOptionalNotes blank → null", () => {
  assert.deepEqual(validateOptionalNotes(""), { ok: true, value: null });
  assert.deepEqual(validateOptionalNotes("  note  "), {
    ok: true,
    value: "note",
  });
});

test("validateLeadTimeDays rejects zero and decimals", () => {
  assert.equal(validateLeadTimeDays(0).ok, false);
  assert.equal(validateLeadTimeDays("14.5").ok, false);
  assert.deepEqual(validateLeadTimeDays("21"), { ok: true, value: 21 });
});

test("validateOptionalLeadTimeDays blank → null", () => {
  assert.deepEqual(validateOptionalLeadTimeDays(""), {
    ok: true,
    value: null,
  });
  assert.deepEqual(validateOptionalLeadTimeDays("14"), {
    ok: true,
    value: 14,
  });
});

test("validateOptionalPositiveInt for MOQ / pack", () => {
  assert.deepEqual(validateOptionalPositiveInt("", "MOQ"), {
    ok: true,
    value: null,
  });
  assert.equal(validateOptionalPositiveInt("0", "MOQ").ok, false);
  assert.deepEqual(validateOptionalPositiveInt("24", "Pack size"), {
    ok: true,
    value: 24,
  });
});

test("validateOptionalUnitCost allows decimals", () => {
  assert.deepEqual(validateOptionalUnitCost("12.5"), {
    ok: true,
    value: 12.5,
  });
  assert.equal(validateOptionalUnitCost("-1").ok, false);
  assert.deepEqual(validateOptionalUnitCost(""), { ok: true, value: null });
});

test("validateSku is required", () => {
  assert.equal(validateSku("").ok, false);
  assert.deepEqual(validateSku(" X-1 "), { ok: true, value: "X-1" });
});

test("validateReorderDefaults enforces ranges and plain-language errors", () => {
  assert.match(
    validateReorderDefaults("0", "1.65").error,
    /Review period must be a whole number/,
  );
  assert.match(
    validateReorderDefaults("14", "6").error,
    /Service-level z must be a number from 0 to 5/,
  );
  assert.deepEqual(validateReorderDefaults("14", "1.65"), {
    ok: true,
    reviewDays: 14,
    serviceLevelZ: 1.65,
  });
});

test("validateSupplierId requires a positive id", () => {
  assert.equal(validateSupplierId("").ok, false);
  assert.deepEqual(validateSupplierId("3"), { ok: true, value: 3 });
});
