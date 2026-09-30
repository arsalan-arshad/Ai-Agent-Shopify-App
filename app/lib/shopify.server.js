import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server.js";

/**
 * TOKEN LIFECYCLE:
 *
 * `expiringOfflineAccessTokens: true` (below) opts into Shopify's expiring
 * offline access tokens: the offline token is valid for 60 minutes, and
 * @shopify/shopify-app-remix (v4.1+) automatically refreshes it using the
 * single-use refresh token stored alongside it, persisting the new
 * refresh token it gets back. This is required for all public apps —
 * Shopify starts rejecting non-expiring offline tokens on Jan 1, 2027.
 *
 * The Session model (prisma/schema.prisma) has `refreshToken` and
 * `refreshTokenExpires` columns for this — required by
 * @shopify/shopify-app-session-storage-prisma for expiring-token support.
 * Nothing else needs to change: refresh happens transparently inside
 * `authenticate.admin`, `authenticate.webhook`, and `unauthenticated.admin`
 * whenever the stored token is expired or expiring within 5 minutes.
 */

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  apiVersion: ApiVersion.October26,
  scopes: process.env.SCOPES?.split(","),
  // `shopify app dev` injects the live tunnel URL as APP_URL, not SHOPIFY_APP_URL.
  appUrl: process.env.SHOPIFY_APP_URL || process.env.APP_URL,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true,
  },
});

export default shopify;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const sessionStorage = shopify.sessionStorage;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
