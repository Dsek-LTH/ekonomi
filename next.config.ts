import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

// Sent on every response. The app holds receipts and members' financial data,
// so the browser is told what it may do with a page from here rather than left
// to its defaults.
//
// script-src is deliberately absent. A CSP worth having would have to allow the
// inline theme script in app/layout.tsx and the ones Next emits for hydration,
// and the only way to do that without 'unsafe-inline' (which would make the
// directive decorative) is a per-request nonce, which a static header cannot
// carry. The directives below are the ones that are worth something without it.
const SECURITY_HEADERS = [
  // Never let the browser second-guess a Content-Type. This is what keeps an
  // uploaded receipt from being sniffed into something executable. See the
  // magic-byte check in api/expenses/[id]/receipts.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Two years, subdomains included. Only ever sent over HTTPS, so it has no
  // effect on local development.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // A receipt URL should not travel to another site as a Referer.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing here is meant to be embedded. frame-ancestors is the modern spelling;
  // X-Frame-Options stays for browsers that only read that one.
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Content-Security-Policy",
    value: [
      "frame-ancestors 'none'",
      "object-src 'none'", // no plugin content, whatever a MIME type claims
      "base-uri 'none'", // an injected <base> can't repoint relative URLs
      "form-action 'self'", // a form here posts here
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // Emit .next/standalone: server.js plus only the node_modules the traced
  // build actually reaches. That is what the Docker image ships. The
  // alternative is copying a 700 MB node_modules into the runtime image to run
  // `next start`. Harmless outside Docker; `next dev` and `next start` ignore it.
  output: "standalone",
  // Native modules, don't bundle them; load them from node_modules. Both ship
  // a platform-specific `.node` binary, which Turbopack cannot place in a
  // JavaScript chunk and refuses outright ("non-ecmascript placeable asset").
  //
  // sharp normalises uploaded receipts; the typst compiler typesets the
  // utläggsräkning (src/lib/expense/cover/typst.ts).
  serverExternalPackages: ["sharp", "@myriaddreamin/typst-ts-node-compiler"],
  experimental: {
    // Turbopack's on-disk dev cache, on by default in Next 16. Off here because
    // it has handed us a stale stylesheet: a new route's utilities never made it
    // into the compiled CSS, the chunk kept its old bytes across every restart,
    // and the page rendered with classes that had no rules behind them, the
    // kind of bug you debug in the wrong place for an hour, because restarting
    // is exactly what should have cleared it.
    //
    // The cost is a slower cold `next dev`; nothing recompiles differently once
    // it is up.
    turbopackFileSystemCacheForDev: false,
    // The production build's cache, on by default since Next 16. Off because
    // nothing reads it: every image build starts from a clean layer, so it only
    // wrote about 200 MB into .next/cache that the next build threw away, and
    // in a layer at that. Halves what `next build` writes.
    turbopackFileSystemCacheForBuild: false,
    // Server source maps cost about a third of the compile and 40 MB of .next,
    // and bought nothing: errors in the server log were printed against the
    // compiled chunks anyway (`_1n74zgk._.js:404:5174`), because nothing there
    // applies them. Browser source maps are a separate setting and stay off by
    // default.
    serverSourceMaps: false,
  },
  // Who may load /_next/* from the dev server when the page was not served from
  // localhost. Next blocks cross-origin dev requests otherwise, which is why
  // the LAN addresses are listed: reaching the dev server from a phone means
  // arriving on one of them.
  //
  // The wildcard is for `pnpm dev:phone`, which puts the dev server behind a
  // Cloudflare quick tunnel. See scripts/dev-phone.sh. The hostname is random
  // per run, so it cannot be listed the way an address can. Development only;
  // `allowedDevOrigins` has no meaning in a build.
  allowedDevOrigins: [
    "192.168.1.76",
    "192.168.0.14",
    "172.20.10.4",
    "*.trycloudflare.com",
  ],
  // The image build skips the type check (SKIP_TYPECHECK=1, set in the
  // Dockerfile). It was 15 to 30 seconds of every build, rerun on code a laptop
  // had already checked. `pnpm build` anywhere else still checks, and
  // `pnpm typecheck` runs the same check alone. Note that with nothing else
  // checking types before a deploy, a type error now reaches production
  // unless someone ran one of those two first.
  typescript: {
    ignoreBuildErrors: process.env.SKIP_TYPECHECK === "1",
  },
  // The framework's version is not the visitor's business.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // /stock/tags was renamed to /stock/events, along with the model behind it.
  // The word had drifted three ways: "tag" in the schema and the URL, "event"
  // in the nav key and a filename, "occasion" in the prose and the headings,
  // and this is the one of the three that a browser had bookmarked.
  //
  // 307 rather than 308: these pages are behind a login, so there is no search
  // engine to inform, and a permanent redirect is cached by the browser
  // forever, which is a long time to live with if the path is ever wanted
  // again. Two rules rather than one wildcard so that the list page itself is
  // covered beyond doubt. Query strings are carried across either way, which
  // is what a shared link to a filtered list needs.
  async redirects() {
    return [
      { source: "/stock/tags", destination: "/stock/events", permanent: false },
      { source: "/stock/tags/:path*", destination: "/stock/events/:path*", permanent: false },
    ];
  },
}

export default withNextIntl(nextConfig);
