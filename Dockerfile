# syntax=docker/dockerfile:1

# Choose between runner and migrator.
# Needed for OKD builds because they don't have --target
ARG TARGET_STAGE=runner

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
#
# Invoke Prisma through Node rather than Corepack's `pnpm` shim. The latter
# downloads/caches pnpm on first use under the current user's home directory;
# OKD supplies an arbitrary UID with `/` as its home, which is not writable.
FROM builder AS migrator
# Files in the image are readable and traversable by an arbitrary UID.  OKD's
# restricted SCC replaces this image user with one from the namespace range;
# group 0 keeps this usable without an /etc/passwd entry for that UID.
USER 1001:0
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

# ── runner ────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# The standalone output, its static assets and public/ are the whole app.
# It writes nothing to disk — receipts go to S3 — so its filesystem can stay
# read-only.  Use group 0 ownership rather than the image's `node` account:
# OKD's restricted SCC runs containers with an arbitrary non-root UID, which
# must still be able to read every runtime file.
COPY --from=builder --chown=1001:0 /app/.next/standalone ./
COPY --from=builder --chown=1001:0 /app/.next/static ./.next/static
COPY --from=builder --chown=1001:0 /app/public ./public

# The utläggsräkning's template and the faces it is set in, read from disk at
# render time rather than bundled. Next's standalone output traces imports, and
# neither a .typ nor a .ttf is one — without this the cover renders in
# `pnpm dev` and finds nothing here. The path mirrors the source tree because
# that is what cover/typst.ts resolves against process.cwd(), which is also the
# compile root; the section's mark it draws is already in public/.
#
# The fonts are not optional dressing. Typst embeds no proportional sans at all,
# so without them this page comes out in a serif here and in Inter everywhere
# else — see the note in cover/typst.ts.
#
# There is no typesetter to install beside them: Typst comes in as an npm
# dependency with a musl build for this image, so `pnpm install` is the whole
# of it.
COPY --from=builder --chown=1001:0 \
     /app/src/lib/expense/cover ./src/lib/expense/cover

# Non-root by default outside OKD. On OKD this is replaced by the namespace's
# arbitrary UID; neither the app nor the migration stage requires a passwd
# entry or writable image filesystem.
USER 1001:0
EXPOSE 3000

# Any answer at all means the server is up: a signed-out request is a redirect,
# not a 200, and this container has no session. A 5xx or a refused connection
# is the failure worth reporting — including the deliberate exit(1) on a
# misconfigured environment (lib/server/startup.ts).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

FROM ${TARGET_STAGE} AS final
