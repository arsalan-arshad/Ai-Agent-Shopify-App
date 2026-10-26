import prisma from "./db.server.js";

/** SPEC defaults — hysteresis requires switch-off > switch-on. */
export const DEFAULT_SWITCH_ON_COVER_DAYS = 3;
export const DEFAULT_SWITCH_OFF_COVER_DAYS = 7;

/**
 * Shop-level pre-order cover thresholds, or SPEC defaults when the merchant
 * hasn't saved a row yet.
 */
export async function getPreorderSetting(shop) {
  const row = await prisma.preorderSetting.findUnique({ where: { shop } });
  if (!row) {
    return {
      shop,
      switchOnCoverDays: DEFAULT_SWITCH_ON_COVER_DAYS,
      switchOffCoverDays: DEFAULT_SWITCH_OFF_COVER_DAYS,
      isDefault: true,
    };
  }
  return {
    shop: row.shop,
    switchOnCoverDays: row.switchOnCoverDays,
    switchOffCoverDays: row.switchOffCoverDays,
    isDefault: false,
  };
}

/**
 * Upserts shop-level cover thresholds. Enforces switchOff > switchOn so the
 * hysteresis pair stays valid (see preorder.js revertRecommendation).
 */
export async function setPreorderSetting(shop, switchOnCoverDays, switchOffCoverDays) {
  if (!Number.isFinite(switchOnCoverDays) || switchOnCoverDays < 0) {
    throw new Error("Switch-on cover days must be zero or a positive number.");
  }
  if (!Number.isFinite(switchOffCoverDays) || switchOffCoverDays < 0) {
    throw new Error("Switch-off cover days must be zero or a positive number.");
  }
  if (!(switchOffCoverDays > switchOnCoverDays)) {
    throw new Error(
      "Switch-off cover days must be greater than switch-on cover days (hysteresis).",
    );
  }

  return prisma.preorderSetting.upsert({
    where: { shop },
    update: { switchOnCoverDays, switchOffCoverDays },
    create: { shop, switchOnCoverDays, switchOffCoverDays },
  });
}

/**
 * All restock dates for a shop (Settings table + snapshot batch load).
 */
export async function listRestockDates(shop) {
  return prisma.restockDate.findMany({
    where: { shop },
    orderBy: [{ sku: "asc" }],
  });
}

/**
 * Upserts a per-SKU restock date. `date` may be a Date or YYYY-MM-DD string.
 * qty is optional and informational only in v0.
 */
export async function setRestockDate(shop, sku, date, qty = null) {
  const normalizedSku = (sku ?? "").toString().trim();
  if (!normalizedSku) {
    throw new Error("SKU is required for a restock date.");
  }

  const parsed = startOfDay(date);
  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw new Error("Restock date must be a valid calendar date (YYYY-MM-DD).");
  }

  let normalizedQty = null;
  if (qty !== null && qty !== undefined && qty !== "") {
    normalizedQty = parseInt(qty, 10);
    if (!Number.isFinite(normalizedQty) || normalizedQty < 0) {
      throw new Error("Expected quantity must be zero or a positive whole number.");
    }
  }

  return prisma.restockDate.upsert({
    where: { shop_sku_restock: { shop, sku: normalizedSku } },
    update: { date: parsed, qty: normalizedQty },
    create: { shop, sku: normalizedSku, date: parsed, qty: normalizedQty },
  });
}

export async function deleteRestockDate(shop, sku) {
  const normalizedSku = (sku ?? "").toString().trim();
  if (!normalizedSku) {
    throw new Error("SKU is required to clear a restock date.");
  }
  await prisma.restockDate.deleteMany({
    where: { shop, sku: normalizedSku },
  });
}

function startOfDay(date) {
  if (date == null || date === "") return null;
  if (typeof date === "string") {
    // Accept YYYY-MM-DD from <input type="date"> without timezone drift.
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
    if (m) {
      return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    }
  }
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
