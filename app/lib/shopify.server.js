import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server.js";

/**
 * TOKEN LIFECYCLE NOTES (relevant to the Jan 1, 2027 migration niche):
 *
 * - @shopify/shopify-app-remix v3.7+ requests EXPIRING offline access
 *   tokens automatically for new installs. You don't need to do anything
 *   extra for a brand-new app like this one.
 *
 * - An expiring offline access token is valid for 60 minutes. Alongside it,
 *   Shopify returns a refresh_token valid for 90 days.
 *
 * - The refresh token is SINGLE-USE: every time you redeem it for a new
 *   access token, Shopify returns a NEW refresh token too. You must persist
 *   the new refresh token immediately or the next refresh will fail.
 *
 * - Session storage (below, via Prisma) must store both the access token
 *   and refresh token, plus their expiry, and refresh proactively before
 *   expiry in any background job / webhook handler that calls the Admin API
 *   outside of a live user request.
 *
 * - If you're retrofitting this pattern onto an EXISTING pre-migration app
 *   that still has non-expiring tokens stored: those old tokens keep working
 *   until Jan 1, 2027, but every merchant needs to trigger a fresh OAuth
 *   grant (re-auth) before then to receive an expiring token + refresh
 *   token pair. Plan a re-auth prompt / banner in the app admin UI well
 *   before the deadline — this is the actual engineering work in a
 *   migration engagement, not just a config flag.
 */

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
  },
});

export default shopify;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const sessionStorage = shopify.sessionStorage;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
