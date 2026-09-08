/** @type {import("@remix-run/dev").AppConfig} */
export default {
  build: {
    sourcemap: !process.env.NODE_ENV || process.env.NODE_ENV === "development",
  },
  future: {
    v3_fetcherPersist: true,
    v3_relativeSplatPath: true,
    v3_throwAbortReason: true,
  },
  ignoredRouteFiles: ["**/.*"],
};
