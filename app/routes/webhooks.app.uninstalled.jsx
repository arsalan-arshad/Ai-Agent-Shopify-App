import { authenticate } from "../lib/shopify.server.js";
import prisma from "../lib/db.server.js";

/**
 * Fires when a merchant uninstalls the app. We delete the Session rows
 * immediately (the access token is already revoked by Shopify, so keeping
 * it around is pointless and risks a background job trying to use a dead
 * token). Everything else (DailyUsage, LeadTimeSetting, ShopAiSettings,
 * etc.) is kept until shop/redact fires — a merchant who reinstalls
 * within that window gets their forecast history and AI settings back
 * instead of starting from zero.
 */
export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (session) {
    await prisma.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
