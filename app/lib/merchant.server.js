import prisma from "./db.server.js";
import { SHOP_PROFILE_QUERY } from "../graphql/queries.js";

const PROFILE_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
const FEEDBACK_MAX_LENGTH = 2000;

/**
 * Reads the store owner's details from the Admin API when we have none,
 * when they're over 30 days old, or when the shop has reinstalled.
 */
export async function syncShopProfile(admin, shop) {
  const existing = await prisma.shopProfile.findUnique({ where: { shop } });
  const reinstalled = !!existing?.uninstalledAt;
  const isFresh =
    existing && !reinstalled && Date.now() - existing.updatedAt.getTime() < PROFILE_REFRESH_MS;
  if (isFresh) return;

  const response = await admin.graphql(SHOP_PROFILE_QUERY);
  const { data } = await response.json();
  const details = {
    shopName: data.shop.name ?? null,
    ownerName: data.shop.shopOwnerName ?? null,
    email: data.shop.email ?? null,
    planName: data.shop.plan?.publicDisplayName ?? null,
    country: data.shop.billingAddress?.countryCodeV2 ?? null,
  };

  await prisma.shopProfile.upsert({
    where: { shop },
    create: { shop, ...details },
    update: reinstalled
      ? { ...details, installedAt: new Date(), uninstalledAt: null }
      : details,
  });
}

export async function markShopUninstalled(shop) {
  await prisma.shopProfile.updateMany({
    where: { shop },
    data: { uninstalledAt: new Date() },
  });
}

export async function getMarketingOptIn(shop) {
  const profile = await prisma.shopProfile.findUnique({
    where: { shop },
    select: { marketingOptIn: true },
  });
  return profile?.marketingOptIn ?? false;
}

export async function setMarketingOptIn(shop, optIn) {
  const data = { marketingOptIn: optIn, marketingOptInAt: optIn ? new Date() : null };
  await prisma.shopProfile.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });
}

export async function saveFeedback(shop, rating, message) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error("Please choose a rating from 1 to 5.");
  }
  const trimmed = message?.trim() || null;
  if (trimmed && trimmed.length > FEEDBACK_MAX_LENGTH) {
    throw new Error(`Please keep your comment under ${FEEDBACK_MAX_LENGTH} characters.`);
  }
  await prisma.feedback.create({ data: { shop, rating, message: trimmed } });
}
