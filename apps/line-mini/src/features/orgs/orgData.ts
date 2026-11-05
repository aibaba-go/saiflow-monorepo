import type { components } from "@saiflow/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api, call } from "../../services/api";

export type OrgView = components["schemas"]["OrganizationDetailOut"];
export type Member = components["schemas"]["MemberOut"];
export type Role = components["schemas"]["RoleOut"];
export type Invitation = components["schemas"]["InvitationOut"];
export type OrgApplication = components["schemas"]["ApplicationOut"];
export type Verification = components["schemas"]["VerificationOut"];

const path = (id: number) => ({ params: { path: { tenant_id: id } } });

export const orgKeys = {
  all: (id: number) => ["org", id] as const,
  view: (id: number) => ["org", id, "view"] as const,
  members: (id: number) => ["org", id, "members"] as const,
  invitations: (id: number) => ["org", id, "invitations"] as const,
  roles: (id: number) => ["org", id, "roles"] as const,
  verification: (id: number) => ["org", id, "verification"] as const,
};

export function useOrg(id: number) {
  return useQuery({
    queryKey: orgKeys.view(id),
    queryFn: () => call(api.GET("/api/v1/organizations/{tenant_id}", path(id))),
  });
}

export function useMembers(id: number) {
  return useQuery({
    queryKey: orgKeys.members(id),
    queryFn: () => call(api.GET("/api/v1/organizations/{tenant_id}/members", path(id))),
  });
}

export function useInvitations(id: number, enabled: boolean) {
  return useQuery({
    queryKey: orgKeys.invitations(id),
    queryFn: () => call(api.GET("/api/v1/organizations/{tenant_id}/invitations", path(id))),
    enabled,
  });
}

export function useRoles(id: number, enabled = true) {
  return useQuery({
    queryKey: orgKeys.roles(id),
    queryFn: () => call(api.GET("/api/v1/organizations/{tenant_id}/roles", path(id))),
    enabled,
  });
}

export function useVerification(id: number) {
  return useQuery({
    queryKey: orgKeys.verification(id),
    queryFn: () => call(api.GET("/api/v1/organizations/{tenant_id}/verification", path(id))),
  });
}

/** Refetch everything shown for this organization after a change. */
export function useRefreshOrg(id: number): () => Promise<void> {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: orgKeys.all(id) });
}

export { path as orgPath };
