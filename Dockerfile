# syntax=docker/dockerfile:1

# Choose between runner and migrator.
# Needed for OKD builds because they don't have --target
ARG TARGET_STAGE=runner

# The app's production image. The serving image holds no compiler, lockfile, or
# source: deps → builder → runner. A separate `migrator` stage contains only
# Prisma and the migration files, without the Next build output.
#
# Local development does not need any of this. `pnpm dev` against
# `pnpm db:up` is still the shorter path. This is for running the whole stack
# (`pnpm app:up`) and for the image the k8s cluster runs.

# ── base ──────────────────────────────────────────────────────────────
# Debian slim keeps the image compact while using glibc. This avoids Alpine's
# musl DNS resolver behavior, which can be unreliable behind some cluster DNS
# configurations. sharp and the Typst compiler both publish glibc prebuilds;
# Prisma 7 compiles queries in WASM rather than a platform-specific engine.
FROM docker.io/node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
 && apt-get install --no-install-recommends -y openssl \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable
WORKDIR /app

# ── deps ──────────────────────────────────────────────────────────────
# Only the manifests, so this layer is reused on every build that did not
# change a dependency. pnpm-workspace.yaml carries the overrides and the
# allowBuilds list (sharp, prisma), without it the postinstall scripts those
# packages need to unpack their binaries never run.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ── builder ───────────────────────────────────────────────────────────
# `prisma generate` first: src/lib/generated is gitignored, so the client the
# app imports does not exist in a fresh checkout and the build would not
# resolve it. `next build` runs with NODE_ENV=production but is exempt from the
# environment check. See the NEXT_PHASE note in lib/server/env.ts. Nothing
# here reaches a database or a bucket.
FROM deps AS builder
COPY . .
RUN pnpm prisma generate
RUN pnpm build

# ── migrator ──────────────────────────────────────────────────────────
# Prisma deploy needs its CLI, configuration, and migration SQL; it does not
# need the application source, generated client, Next build output, or the
# application's dependency tree. Its own lockfile keeps this small dependency
# set reproducible and independently cacheable.
#
# docker/migrator/ is npm rather than pnpm on purpose, and it is the only npm
# lockfile in the repository. `npm ci` against a two-line manifest is what
# makes this stage independent of the app's install: no workspace file, no
# overrides, no store mount, nothing to invalidate when a dependency of the app
# changes. It lives under docker/ because it exists for this stage and nothing
# else reads it.
FROM base AS migrator-deps
WORKDIR /migrator
COPY docker/migrator/package.json docker/migrator/package-lock.json ./
RUN npm ci --omit=dev

FROM base AS migrator
#
# Invoke Prisma through Node rather than Corepack's `pnpm` shim. The latter
# downloads/caches pnpm on first use under the current user's home directory;
# OKD supplies an arbitrary UID with `/` as its home, which is not writable.
COPY --from=migrator-deps --chown=1001:0 /migrator/node_modules ./node_modules
COPY --chown=1001:0 prisma ./prisma
COPY --chown=1001:0 prisma.config.ts ./
# prisma.config.ts imports this, so `migrate deploy` does not start without it.
# The rest of scripts/ is maintenance tooling that has no business in the image.
COPY --chown=1001:0 scripts/load-env.ts ./scripts/load-env.ts
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
# It writes nothing to disk. Receipts go to S3, so its filesystem can stay
# read-only.  Use group 0 ownership rather than the image's `node` account:
# OKD's restricted SCC runs containers with an arbitrary non-root UID, which
# must still be able to read every runtime file.
COPY --from=builder --chown=1001:0 /app/.next/standalone ./
COPY --from=builder --chown=1001:0 /app/.next/static ./.next/static
COPY --from=builder --chown=1001:0 /app/public ./public

# The utläggsräkning's template and the faces it is set in, read from disk at
# render time rather than bundled. Next's standalone output traces imports, and
# neither a .typ nor a .ttf is one, without this the cover renders in
# `pnpm dev` and finds nothing here. The path mirrors the source tree because
# that is what cover/typst.ts resolves against process.cwd(), which is also the
# compile root; the section's mark it draws is already in public/.
#
# The fonts are not optional dressing. Typst embeds no proportional sans at all,
# so without them this page comes out in a serif here and in Inter everywhere
# else. See the note in cover/typst.ts.
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
# is the failure worth reporting, including the deliberate exit(1) on a
# misconfigured environment (lib/server/startup.ts).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

FROM ${TARGET_STAGE} AS final
