export const ORGANIZATION_TYPES = [
  "OSVC",
  "ASSOCIATION",
  "SRO",
  "OTHER",
] as const;

export type OrganizationType = typeof ORGANIZATION_TYPES[number];
export type OrganizationRole = "OWNER" | "MEMBER";

export interface OrganizationSummary {
  id: string;
  type: OrganizationType;
  officialName: string;
  displayName: string;
  role: OrganizationRole;
}

export function isOrganizationType(value: string): value is OrganizationType {
  return (ORGANIZATION_TYPES as readonly string[]).includes(value);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}
