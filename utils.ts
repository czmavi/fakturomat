import { createDefine } from "fresh";
import type { AuthenticatedUser } from "@/domain/auth/types.ts";
import type { OrganizationSummary } from "@/domain/organizations/types.ts";

// This specifies the type of "ctx.state" which is used to share
// data among middlewares, layouts and routes.
export interface State {
  user: AuthenticatedUser | null;
  sessionTokenHash: string | null;
  csrfToken: string;
  organizations: OrganizationSummary[];
  currentOrganization: OrganizationSummary | null;
}

export const define = createDefine<State>();
