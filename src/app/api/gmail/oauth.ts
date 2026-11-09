// Shared by /api/gmail/connect and /callback: the nonce cookie, where Google sends the person back, and who
// may connect. The mailbox is read for the whole section, so connecting it is a settings matter, the same
// as the Fortnox service connection.
import { serverEnv } from "@/lib/server/env";

export const STATE_COOKIE = "gmail_oauth_state";
export const RETURN_TO = "/invoices/inbox";

export const redirectUri = () => `${serverEnv("APP_URL")}/api/gmail/callback`;
