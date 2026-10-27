import prisma from "./db.server.js";
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
} from "./reorder-validation.js";

/** SPEC / PROJECT_CONTEXT D4 defaults. */
export const DEFAULT_REVIEW_DAYS = 14;
export const DEFAULT_SERVICE_LEVEL_Z = 1.65;

/**
 * Shop-level reorder defaults, or SPEC defaults when no row yet.
 */
export async function getReorderSetting(shop) {
  const row = await prisma.reorderSetting.findUnique({ where: { shop } });
  if (!row) {
    return {
      shop,
      reviewDays: DEFAULT_REVIEW_DAYS,
      serviceLevelZ: DEFAULT_SERVICE_LEVEL_Z,
      isDefault: true,
    };
  }
  return {
    shop: row.shop,
    reviewDays: row.reviewDays,
    serviceLevelZ: row.serviceLevelZ,
    isDefault: false,
  };
}

/**
 * Upserts shop-level review period + service-level z.
 */
export async function setReorderSetting(shop, reviewDays, serviceLevelZ) {
  const parsed = validateReorderDefaults(reviewDays, serviceLevelZ);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }

  return prisma.reorderSetting.upsert({
    where: { shop },
    update: {
      reviewDays: parsed.reviewDays,
      serviceLevelZ: parsed.serviceLevelZ,
    },
    create: {
      shop,
      reviewDays: parsed.reviewDays,
      serviceLevelZ: parsed.serviceLevelZ,
    },
  });
}

/**
 * All suppliers for a shop (Settings + snapshot batch load).
 */
export async function listSuppliers(shop) {
  return prisma.supplier.findMany({
    where: { shop },
    orderBy: [{ name: "asc" }],
  });
}

/**
 * Create a supplier. Names are unique per shop (case-sensitive trim).
 */
export async function createSupplier(
  shop,
  name,
  defaultLeadTimeDays = DEFAULT_REVIEW_DAYS,
  notes = null,
) {
  const nameResult = validateSupplierName(name);
  if (!nameResult.ok) throw new Error(nameResult.error);

  const leadResult = validateLeadTimeDays(defaultLeadTimeDays);
  if (!leadResult.ok) throw new Error(leadResult.error);

  const notesResult = validateOptionalNotes(notes);
  if (!notesResult.ok) throw new Error(notesResult.error);

  try {
    return await prisma.supplier.create({
      data: {
        shop,
        name: nameResult.value,
        defaultLeadTimeDays: leadResult.value,
        notes: notesResult.value,
      },
    });
  } catch (err) {
    if (err?.code === "P2002") {
      throw new Error(
        `A supplier named "${nameResult.value}" already exists for this shop.`,
      );
    }
    throw err;
  }
}

/**
 * Update an existing supplier owned by this shop.
 */
export async function updateSupplier(
  shop,
  id,
  { name, defaultLeadTimeDays, notes } = {},
) {
  const existing = await prisma.supplier.findFirst({
    where: { shop, id: Number(id) },
  });
  if (!existing) {
    throw new Error("Supplier not found.");
  }

  const data = {};
  if (name !== undefined) {
    const nameResult = validateSupplierName(name);
    if (!nameResult.ok) throw new Error(nameResult.error);
    data.name = nameResult.value;
  }
  if (defaultLeadTimeDays !== undefined) {
    const leadResult = validateLeadTimeDays(defaultLeadTimeDays);
    if (!leadResult.ok) throw new Error(leadResult.error);
    data.defaultLeadTimeDays = leadResult.value;
  }
  if (notes !== undefined) {
    const notesResult = validateOptionalNotes(notes);
    if (!notesResult.ok) throw new Error(notesResult.error);
    data.notes = notesResult.value;
  }

  try {
    return await prisma.supplier.update({
      where: { id: existing.id },
      data,
    });
  } catch (err) {
    if (err?.code === "P2002") {
      throw new Error("A supplier with that name already exists for this shop.");
    }
    throw err;
  }
}

/**
 * Delete a supplier (cascades its SkuSupplierTerms).
 */
export async function deleteSupplier(shop, id) {
  const existing = await prisma.supplier.findFirst({
    where: { shop, id: Number(id) },
  });
  if (!existing) {
    throw new Error("Supplier not found.");
  }
  await prisma.supplier.delete({ where: { id: existing.id } });
}

/**
 * All per-SKU terms for a shop, with supplier name joined.
 */
export async function listSkuSupplierTerms(shop) {
  return prisma.skuSupplierTerms.findMany({
    where: { shop },
    include: { supplier: { select: { id: true, name: true, defaultLeadTimeDays: true } } },
    orderBy: [{ sku: "asc" }],
  });
}

/**
 * Upsert per-SKU supplier terms.
 */
export async function setSkuSupplierTerms(
  shop,
  {
    sku,
    supplierId,
    leadTimeDays = null,
    moq = null,
    packSize = null,
    unitCost = null,
  },
) {
  const skuResult = validateSku(sku);
  if (!skuResult.ok) throw new Error(skuResult.error);

  const supplierResult = validateSupplierId(supplierId);
  if (!supplierResult.ok) throw new Error(supplierResult.error);

  const supplier = await prisma.supplier.findFirst({
    where: { shop, id: supplierResult.value },
  });
  if (!supplier) {
    throw new Error("Pick a supplier from the list.");
  }

  const leadResult = validateOptionalLeadTimeDays(leadTimeDays);
  if (!leadResult.ok) throw new Error(leadResult.error);

  const moqResult = validateOptionalPositiveInt(moq, "MOQ");
  if (!moqResult.ok) throw new Error(moqResult.error);

  const packResult = validateOptionalPositiveInt(packSize, "Pack size");
  if (!packResult.ok) throw new Error(packResult.error);

  const costResult = validateOptionalUnitCost(unitCost);
  if (!costResult.ok) throw new Error(costResult.error);

  return prisma.skuSupplierTerms.upsert({
    where: { shop_sku_terms: { shop, sku: skuResult.value } },
    update: {
      supplierId: supplierResult.value,
      leadTimeDays: leadResult.value,
      moq: moqResult.value,
      packSize: packResult.value,
      unitCost: costResult.value,
    },
    create: {
      shop,
      sku: skuResult.value,
      supplierId: supplierResult.value,
      leadTimeDays: leadResult.value,
      moq: moqResult.value,
      packSize: packResult.value,
      unitCost: costResult.value,
    },
  });
}

export async function deleteSkuSupplierTerms(shop, sku) {
  const skuResult = validateSku(sku);
  if (!skuResult.ok) throw new Error(skuResult.error);
  await prisma.skuSupplierTerms.deleteMany({
    where: { shop, sku: skuResult.value },
  });
}

/**
 * Parse a simple CSV of SKU terms and upsert each row.
 * Expected header (case-insensitive): sku,supplier,lead_time_days,moq,pack_size,unit_cost
 * `supplier` is the supplier name (must already exist).
 *
 * @returns {{ ok: number, errors: string[] }}
 */
export async function importSkuSupplierTermsCsv(shop, csvText) {
  if (typeof csvText !== "string" || !csvText.trim()) {
    throw new Error("Paste a CSV with a header row and at least one data row.");
  }

  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) {
    throw new Error("CSV needs a header row and at least one data row.");
  }

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = {
    sku: header.indexOf("sku"),
    supplier: header.indexOf("supplier"),
    lead: header.indexOf("lead_time_days"),
    moq: header.indexOf("moq"),
    pack: header.indexOf("pack_size"),
    cost: header.indexOf("unit_cost"),
  };
  if (idx.sku < 0 || idx.supplier < 0) {
    throw new Error(
      'CSV header must include at least "sku" and "supplier" columns.',
    );
  }

  const suppliers = await listSuppliers(shop);
  const byName = new Map(suppliers.map((s) => [s.name.toLowerCase(), s]));

  let ok = 0;
  const errors = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const rowNum = i + 1;
    const sku = cols[idx.sku] ?? "";
    const supplierName = cols[idx.supplier] ?? "";
    const supplier = byName.get(supplierName.trim().toLowerCase());
    if (!supplier) {
      errors.push(
        `Row ${rowNum}: unknown supplier "${supplierName.trim() || "(blank)"}". Add the supplier first.`,
      );
      continue;
    }
    try {
      await setSkuSupplierTerms(shop, {
        sku,
        supplierId: supplier.id,
        leadTimeDays: idx.lead >= 0 ? cols[idx.lead] : null,
        moq: idx.moq >= 0 ? cols[idx.moq] : null,
        packSize: idx.pack >= 0 ? cols[idx.pack] : null,
        unitCost: idx.cost >= 0 ? cols[idx.cost] : null,
      });
      ok += 1;
    } catch (err) {
      errors.push(`Row ${rowNum}: ${err.message ?? "Could not save."}`);
    }
  }

  return { ok, errors };
}

/** Minimal CSV line parser (handles quoted fields). */
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
