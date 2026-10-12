# syntax=docker/dockerfile:1

# The app's production image. The serving image holds no compiler, lockfile, or
# source: deps → builder → runner. A separate `migrator` stage contains only
# Prisma and the migration files, without the Next build output.
#
# The runner also carries a copy of the migrator under /migrator. OKD builds
# exactly one image per build, and two builds of one commit finish at different
# times, so the cluster runs migrations from the runner image instead. Schema
# and code then always come from the same build. The default (last) stage is
# the runner.
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

# ── assemble ──────────────────────────────────────────────────────────
# Lays out everything the runner ships under /out, in one RUN, so the runner
# can take it in with a single COPY.
#
# This is about build time on OKD, not image size. Its builder gives every
# instruction a layer of its own, and a COPY into a stage that already holds
# the app is paid for in full each time: ten of them used to cost most of a
# thirty minute build. One RUN here and one COPY below is two layers. Both
# trees together are about 13,000 files, more than half of them the Prisma CLI
# under /migrator.
#
# FROM builder because the build output and the source tree (prisma/, the
# typst templates, scripts/) are already in it. The migrator's node_modules is
# bind-mounted rather than copied in, which would be another layer.
#
# Every copy is `dir/.` into a directory made first. The standalone output
# already holds a few of these paths (traced files under public/ and src/), and
# a plain `cp -a dir dest` into an existing dest nests it one level down.
FROM builder AS assemble
RUN --mount=type=bind,from=migrator-deps,source=/migrator/node_modules,target=/migrator-deps \
    set -e; \
    mkdir -p /out/app/.next/static /out/app/public /out/app/src/lib/expense/cover \
             /out/app/src/lib/contract/rental /out/app/src/lib/server/fonts \
             /out/migrator/node_modules /out/migrator/scripts; \
    cp -a .next/standalone/. /out/app/; \
    cp -a .next/static/. /out/app/.next/static/; \
    cp -a public/. /out/app/public/; \
    cp -a src/lib/expense/cover/. /out/app/src/lib/expense/cover/; \
    cp -a src/lib/contract/rental/. /out/app/src/lib/contract/rental/; \
    cp -a src/lib/server/fonts/. /out/app/src/lib/server/fonts/; \
    cp -a /migrator-deps/. /out/migrator/node_modules/; \
    cp -a prisma prisma.config.ts /out/migrator/; \
    cp -a scripts/load-env.ts /out/migrator/scripts/

# ── runner ────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Everything below lands in this one COPY, laid out by the assemble stage:
#
#   /app       the standalone output, its static assets, public/, and the
#              typst templates and fonts
#   /migrator  Prisma and the migrations, for the init container
#
# The standalone output, its static assets and public/ are the whole app.
# It writes nothing to disk. Receipts go to S3, so its filesystem can stay
# read-only.  Use group 0 ownership rather than the image's `node` account:
# OKD's restricted SCC runs containers with an arbitrary non-root UID, which
# must still be able to read every runtime file.
#
# The templates the app typesets and the faces they are set in are read from
# disk at render time rather than bundled. Next's standalone output traces
# imports, and neither a .typ nor an .otf is one, so without them they render
# in `pnpm dev` and find nothing here. The paths mirror the source tree because
# that is what lib/server/typst.ts resolves against process.cwd(), which is also
# the compile root; the section's mark they draw is already in public/.
#
# Three directories, and each is load-bearing:
#
#   expense/cover    the utläggsräkning's template, and Inter
#   contract/rental  the uthyrningsavtal's template
#   server/fonts     Domitian and TeX Gyre Heros, the guild's own faces
#
# The fonts are not optional dressing. Typst embeds no proportional sans at all
# and neither of the guild's faces, so without them the utläggsräkning comes out
# in a serif and the uthyrningsavtal in something that is not the house style,
# here and nowhere else. That is the worst kind of difference: the contract a
# renter signs would not match the one drawn on the laptop it was checked on.
# See the note in lib/server/typst.ts.
#
# There is no typesetter to install beside them: Typst comes in as an npm
# dependency with a musl build for this image, so `pnpm install` is the whole
# of it.
#
# /migrator is for the cluster's init container to run with
# `node node_modules/prisma/build/index.js migrate deploy`. Its own directory
# because the standalone output already has a node_modules in /app.
COPY --from=assemble --chown=1001:0 /out/ /

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
