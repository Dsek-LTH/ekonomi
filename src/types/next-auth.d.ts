import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string; studentId?: string } & DefaultSession["user"];
  }

  interface User {
    studentId?: string;
    groups?: string[];
  }
}
