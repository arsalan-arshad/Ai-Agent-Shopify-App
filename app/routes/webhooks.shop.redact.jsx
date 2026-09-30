import { authenticate } from "../lib/shopify.server.js";
import prisma from "../lib/db.server.js";

/**
 * Mandatory compliance webhook: fires ~48 hours after uninstall (or on
 * request) — delete everything we still have for this shop. Unlike
 * app/uninstalled (which only clears Session), this is the permanent,
 * full teardown across every model that's keyed by shop.
 */
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} for ${shop} — deleting all stored data.`);

  await prisma.$transaction([
    prisma.dailyUsage.deleteMany({ where: { shop } }),
    prisma.processedOrder.deleteMany({ where: { shop } }),
    prisma.leadTimeSetting.deleteMany({ where: { shop } }),
    prisma.aiUsageLog.deleteMany({ where: { shop } }),
    prisma.shopAiSettings.deleteMany({ where: { shop } }),
    prisma.shopProfile.deleteMany({ where: { shop } }),
    prisma.feedback.deleteMany({ where: { shop } }),
    prisma.session.deleteMany({ where: { shop } }),
  ]);

  return new Response();
};
