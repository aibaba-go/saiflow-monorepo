import type { components } from "@saiflow/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { api, call } from "../../services/api";
import { ApiError } from "../../services/errors";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import type { FileOut } from "./upload";

export type JobOut = components["schemas"]["JobOut"];

/** Query keys shared by the scan pages. */
export const pendingKey = (tenantId: number | undefined) => ["files", "pending", tenantId];
export const jobsKey = (tenantId: number | undefined, stage?: string) => ["jobs", tenantId, stage];

export function usePending() {
  const { tenant } = useCurrentTenant();
  return useQuery({
    queryKey: pendingKey(tenant?.tenant_id),
    queryFn: () => call(api.GET("/api/v1/files/pending")),
    enabled: tenant !== null,
  });
}

const KEY_PREFIX = "saiflow.jobkey.";

/** One idempotency key per tenant and file, kept until the job exists (AC-FR-SYS-058-03):
 * a manual retry after an unclear result sends the same key, so only one job is made. */
function idempotencyKey(tenantId: number, fileId: string): string {
  const name = `${KEY_PREFIX}${tenantId}.${fileId}`;
  try {
    const kept = sessionStorage.getItem(name);
    if (kept) return kept;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(name, fresh);
    return fresh;
  } catch {
    return `${tenantId}.${fileId}`; // storage blocked: still stable for this file
  }
}

function forgetKey(tenantId: number, fileId: string): void {
  try {
    sessionStorage.removeItem(`${KEY_PREFIX}${tenantId}.${fileId}`);
  } catch {
    // nothing kept
  }
}

export interface StartResult {
  jobs: JobOut[];
  error: ApiError | null;
}

/** Create the jobs one by one in order; stop at the first failure (FR-SYS-058). Never
 * retries by itself. Files that already have a job are left out of later runs. */
export function useCreateJobs() {
  const { tenant } = useCurrentTenant();
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const run = useCallback(
    async (files: FileOut[]): Promise<StartResult> => {
      const tenantId = tenant?.tenant_id ?? 0;
      const jobs: JobOut[] = [];
      setPending(true);
      try {
        for (const file of files) {
          try {
            const job = await call(
              api.POST("/api/v1/ocr/jobs", {
                body: { file_id: file.id, idempotency_key: idempotencyKey(tenantId, file.id) },
              }),
            );
            forgetKey(tenantId, file.id);
            jobs.push(job);
          } catch (error) {
            return { jobs, error: error instanceof ApiError ? error : new ApiError(0, "unknown", []) };
          }
        }
        return { jobs, error: null };
      } finally {
        setPending(false);
        void client.invalidateQueries({ queryKey: ["files", "pending"] });
        void client.invalidateQueries({ queryKey: ["jobs"] });
        void client.invalidateQueries({ queryKey: ["usage"] });
      }
    },
    [tenant?.tenant_id, client],
  );
  return { run, pending };
}
