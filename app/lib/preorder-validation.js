/**
 * Pure validators for pre-order Settings inputs.
 * No imports, no I/O — safe for unit tests and server use.
 */

const MAX_QTY = 2147483647;
const MAX_COVER_DAYS = 365;

/**
 * Parse a non-negative whole number from a string or number.
 * Rejects decimals ("3.5"), signs, exponents, and empty strings.
 * @param {unknown} value
 * @returns {number | null} null when not a valid whole number
 */
function parseWholeNumber(value) {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || !Number.isFinite(value)) return null;
    return value;
  }
  if (typeof value === "string") {
    const s = value.trim();
    // Digits only — rejects "3.5", "-1", "1e2", "  ", etc.
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    if (!Number.isSafeInteger(n)) return null;
    return n;
  }
  return null;
}

/**
 * Optional expected restock quantity.
 * Blank / null / undefined → null. Otherwise an integer 0…2147483647.
 *
 * @param {unknown} qty
 * @returns {{ ok: true, value: number | null } | { ok: false, error: string }}
 */
export function validateOptionalQty(qty) {
  if (qty === null || qty === undefined) {
    return { ok: true, value: null };
  }
  if (typeof qty === "string" && qty.trim() === "") {
    return { ok: true, value: null };
  }

  const n = parseWholeNumber(qty);
  if (n === null || n < 0 || n > MAX_QTY) {
    return {
      ok: false,
      error:
        "Expected quantity must be a whole number from 0 to 2,147,483,647, or left blank.",
    };
  }
  return { ok: true, value: n };
}

/**
 * Shop-level switch-on / switch-off cover day thresholds.
 * Both must be whole numbers from 0 to 365, and switch-off must be greater
 * than switch-on (hysteresis).
 *
 * @param {unknown} switchOnCoverDays
 * @param {unknown} switchOffCoverDays
 * @returns {{ ok: true, switchOnCoverDays: number, switchOffCoverDays: number } | { ok: false, error: string }}
 */
export function validateCoverDays(switchOnCoverDays, switchOffCoverDays) {
  const on = parseWholeNumber(switchOnCoverDays);
  const off = parseWholeNumber(switchOffCoverDays);

  if (
    on === null ||
    off === null ||
    on < 0 ||
    off < 0 ||
    on > MAX_COVER_DAYS ||
    off > MAX_COVER_DAYS
  ) {
    return {
      ok: false,
      error: "Cover days must be whole numbers from 0 to 365.",
    };
  }

  if (!(off > on)) {
    return {
      ok: false,
      error:
        "Switch-off cover days must be greater than switch-on cover days.",
    };
  }

  return { ok: true, switchOnCoverDays: on, switchOffCoverDays: off };
}
