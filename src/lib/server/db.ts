// Prisma client singleton (node-postgres adapter). The guard prevents exhausting connections on hot-reload.
import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { serverEnv } from "./env";

const createClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: serverEnv("DATABASE_URL") }),
  });

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createClient>;
};

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
