# syntax=docker/dockerfile:1

# The app's production image. Four stages, so the thing that ships holds no
# compiler, no lockfile and no source: deps → builder → runner, plus a
# `migrator` stage that keeps the Prisma CLI around for `migrate deploy`.
#
# Local development does not need any of this — `pnpm dev` against
# `pnpm db:up` is still the shorter path. This is for running the whole stack
# (`pnpm app:up`) and for the image the k8s cluster runs.

# ── base ──────────────────────────────────────────────────────────────
# Alpine keeps the runtime small. sharp and Prisma both matter here: sharp
# resolves a musl build of libvips from its own optional dependencies, and
# Prisma 7 compiles queries in WASM rather than a platform-specific engine
# binary, so neither needs a glibc image.
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# ── deps ──────────────────────────────────────────────────────────────
# Only the manifests, so this layer is reused on every build that did not
# change a dependency. pnpm-workspace.yaml carries the overrides and the
# allowBuilds list (sharp, prisma) — without it the postinstall scripts those
# packages need to unpack their binaries never run.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ── builder ───────────────────────────────────────────────────────────
# `prisma generate` first: src/lib/generated is gitignored, so the client the
# app imports does not exist in a fresh checkout and the build would not
# resolve it. `next build` runs with NODE_ENV=production but is exempt from the
# environment check — see the NEXT_PHASE note in lib/server/env.ts. Nothing
# here reaches a database or a bucket.
FROM deps AS builder
COPY . .
RUN pnpm prisma generate
RUN pnpm build

# ── migrator ──────────────────────────────────────────────────────────
# The builder kept whole: node_modules with the Prisma CLI, prisma/migrations,
# and the generated client the seed imports. Runs to completion and exits —
# compose starts it before the app, and `pnpm db:seed` can be run in it too.
FROM builder AS migrator
CMD ["pnpm", "prisma", "migrate", "deploy"]

# ── runner ────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# The standalone output, its static assets and public/ are the whole app.
# `node` (uid 1000) ships with the image; the app writes nothing to disk —
# receipts go to S3 — so it owns nothing and runs unprivileged.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node
EXPOSE 3000

# Any answer at all means the server is up: a signed-out request is a redirect,
# not a 200, and this container has no session. A 5xx or a refused connection
# is the failure worth reporting — including the deliberate exit(1) on a
# misconfigured environment (lib/server/startup.ts).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
