import { PrismaClient } from "@prisma/client";

// Standard Remix dev-mode singleton pattern to avoid exhausting DB
// connections on hot reload.
if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

export default prisma;
