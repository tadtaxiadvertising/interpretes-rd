import type { DefaultSession } from "next-auth";

import type { RbacRole } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user?: DefaultSession["user"] & {
      id?: string;
      role?: RbacRole | string;
    };
  }

  interface User {
    role?: RbacRole | string;
  }
}
