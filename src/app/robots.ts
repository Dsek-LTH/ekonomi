import type { MetadataRoute } from "next";

/**
 * Only the sign-in page is public. Everything else redirects a crawler to it
 * anyway, so this keeps bots off the app and the API and saves them the trip.
 * `/$` is the bare root, which redirects to /login.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/$", "/login"], disallow: "/" },
  };
}
