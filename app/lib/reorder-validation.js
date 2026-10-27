/**
 * Pure validators for Reorder Brain Settings inputs.
 * No imports, no I/O — safe for unit tests and server use.
 */

const MAX_DAYS = 365;
const MAX_QTY = 2147483647;
const MAX_NAME_LEN = 120;
const MAX_NOTES_LEN = 2000;
const MAX_UNIT_COST = 1_000_000;

/**
 * Parse a non-negative whole number from a string or number.
 * Rejects decimals, signs, exponents, and empty strings.
 * @param {unknown} value
 * @returns {number | null}
 */
function parseWholeNumber(value) {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || !Number.isFinite(value)) return null;
    return value;
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    if (!Number.isSafeInteger(n)) return null;
    return n;
  }
  return null;
}

/**
 * Parse a non-negative finite number (allows decimals) for unit cost / z.
 * @param {unknown} value
 * @returns {number | null}
 */
function parseNonNegativeNumber(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return value;
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (s === "" || !/^\d+(\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  }
  return null;
}

/**
 * Supplier name: required, 1–120 chars after trim.
 *
 * @param {unknown} name
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function validateSupplierName(name) {
  if (typeof name !== "string" || !name.trim()) {
    return { ok: false, error: "Supplier name is required." };
  }
  const value = name.trim();
  if (value.length > MAX_NAME_LEN) {
    return {
      ok: false,
      error: `Supplier name must be ${MAX_NAME_LEN} characters or fewer.`,
    };
  }
  return { ok: true, value };
}

/**
 * Optional notes (blank → null).
 *
 * @param {unknown} notes
 * @returns {{ ok: true, value: string | null } | { ok: false, error: string }}
 */
export function validateOptionalNotes(notes) {
  if (notes === null || notes === undefined) {
    return { ok: true, value: null };
  }
  if (typeof notes !== "string") {
    return { ok: false, error: "Notes must be plain text." };
  }
  const value = notes.trim();
  if (value === "") return { ok: true, value: null };
  if (value.length > MAX_NOTES_LEN) {
    return {
      ok: false,
      error: `Notes must be ${MAX_NOTES_LEN} characters or fewer.`,
    };
  }
  return { ok: true, value };
}

/**
 * Default / override lead time in days (1–365).
 *
 * @param {unknown} leadTimeDays
 * @returns {{ ok: true, value: number } | { ok: false, error: string }}
 */
export function validateLeadTimeDays(leadTimeDays) {
  const n = parseWholeNumber(leadTimeDays);
  if (n === null || n < 1 || n > MAX_DAYS) {
    return {
      ok: false,
      error: "Lead time must be a whole number of days from 1 to 365.",
    };
  }
  return { ok: true, value: n };
}

/**
 * Optional lead-time override (blank → null).
 *
 * @param {unknown} leadTimeDays
 * @returns {{ ok: true, value: number | null } | { ok: false, error: string }}
 */
export function validateOptionalLeadTimeDays(leadTimeDays) {
  if (leadTimeDays === null || leadTimeDays === undefined) {
    return { ok: true, value: null };
  }
  if (typeof leadTimeDays === "string" && leadTimeDays.trim() === "") {
    return { ok: true, value: null };
  }
  return validateLeadTimeDays(leadTimeDays);
}

/**
 * Optional MOQ / pack size (blank → null). Whole number 1…MAX_QTY when set.
 *
 * @param {unknown} value
 * @param {string} label
 * @returns {{ ok: true, value: number | null } | { ok: false, error: string }}
 */
export function validateOptionalPositiveInt(value, label) {
  if (value === null || value === undefined) {
    return { ok: true, value: null };
  }
  if (typeof value === "string" && value.trim() === "") {
    return { ok: true, value: null };
  }
  const n = parseWholeNumber(value);
  if (n === null || n < 1 || n > MAX_QTY) {
    return {
      ok: false,
      error: `${label} must be a whole number from 1 to 2,147,483,647, or left blank.`,
    };
  }
  return { ok: true, value: n };
}

/**
 * Optional unit cost (blank → null). Non-negative number up to 1e6.
 *
 * @param {unknown} unitCost
 * @returns {{ ok: true, value: number | null } | { ok: false, error: string }}
 */
export function validateOptionalUnitCost(unitCost) {
  if (unitCost === null || unitCost === undefined) {
    return { ok: true, value: null };
  }
  if (typeof unitCost === "string" && unitCost.trim() === "") {
    return { ok: true, value: null };
  }
  const n = parseNonNegativeNumber(unitCost);
  if (n === null || n > MAX_UNIT_COST) {
    return {
      ok: false,
      error:
        "Unit cost must be a number from 0 to 1,000,000, or left blank.",
    };
  }
  return { ok: true, value: Math.round(n * 100) / 100 };
}

/**
 * SKU required for terms.
 *
 * @param {unknown} sku
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function validateSku(sku) {
  if (typeof sku !== "string" || !sku.trim()) {
    return { ok: false, error: "SKU is required." };
  }
  const value = sku.trim();
  if (value.length > 255) {
    return { ok: false, error: "SKU must be 255 characters or fewer." };
  }
  return { ok: true, value };
}

/**
 * Shop-level reorder defaults: review days (1–365) and service-level z (0–5).
 *
 * @param {unknown} reviewDays
 * @param {unknown} serviceLevelZ
 * @returns {{ ok: true, reviewDays: number, serviceLevelZ: number } | { ok: false, error: string }}
 */
export function validateReorderDefaults(reviewDays, serviceLevelZ) {
  const days = parseWholeNumber(reviewDays);
  if (days === null || days < 1 || days > MAX_DAYS) {
    return {
      ok: false,
      error: "Review period must be a whole number of days from 1 to 365.",
    };
  }

  const z = parseNonNegativeNumber(serviceLevelZ);
  if (z === null || z > 5) {
    return {
      ok: false,
      error:
        "Service-level z must be a number from 0 to 5 (1.65 ≈ 95% service level).",
    };
  }

  return {
    ok: true,
    reviewDays: days,
    serviceLevelZ: Math.round(z * 100) / 100,
  };
}

/**
 * Supplier id must be a positive integer.
 *
 * @param {unknown} supplierId
 * @returns {{ ok: true, value: number } | { ok: false, error: string }}
 */
export function validateSupplierId(supplierId) {
  const n = parseWholeNumber(supplierId);
  if (n === null || n < 1) {
    return { ok: false, error: "Pick a supplier from the list." };
  }
  return { ok: true, value: n };
}
