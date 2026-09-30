// Aggregate portfolio numbers across all shops. Deliberately a CLI script,
// not a route: it prints totals only and is never reachable over HTTP.
// Usage: npm run stats (reads DATABASE_URL from the environment / .env)
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const [installs, activeStores, optedIn, questions, orders, skuPairs, feedback] =
    await Promise.all([
      prisma.shopProfile.count(),
      prisma.shopProfile.count({ where: { uninstalledAt: null } }),
      prisma.shopProfile.count({ where: { marketingOptIn: true, uninstalledAt: null } }),
      prisma.aiUsageLog.count({ where: { ok: true } }),
      prisma.processedOrder.count(),
      prisma.dailyUsage.groupBy({ by: ["shop", "sku"] }),
      prisma.feedback.aggregate({ _count: { _all: true }, _avg: { rating: true } }),
    ]);

  const avg = feedback._avg.rating;
  console.table({
    "Stores recorded (installed, incl. not yet redacted)": installs,
    "Active stores": activeStores,
    "Active stores opted in to contact": optedIn,
    "AI questions answered": questions,
    "Orders processed": orders,
    "SKUs being forecast": skuPairs.length,
    "Feedback responses": feedback._count._all,
    "Average rating": avg === null ? "—" : avg.toFixed(2),
  });
} finally {
  await prisma.$disconnect();
}
