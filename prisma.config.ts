// Prisma 7 configuration. The datasource URL and seed command moved here
// out of schema.prisma. Env is loaded explicitly — the config file does not
// read .env automatically.
import { defineConfig } from "prisma/config";

process.loadEnvFile?.(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL!,
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
