// Prisma 7 configuration. The datasource URL and seed command moved here
// out of schema.prisma. Env is loaded explicitly, the config file does not
// read .env automatically.
import { defineConfig } from "prisma/config";
import { loadEnvFile } from "./scripts/load-env";

loadEnvFile();

export default defineConfig({
  // A folder, not a file: every *.prisma under it is one schema, split by
  // domain so a model is findable by the thing it belongs to. Both paths are
  // written out rather than inferred, because the migrations directory is
  // derived from the schema location and moving the schema silently moving the
  // migrations is not a thing to leave to a default.
  schema: "prisma/schema",
  datasource: {
    url: process.env.DATABASE_URL!,
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
