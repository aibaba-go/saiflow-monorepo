import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { api, call } from "../../services/api";
import { useCurrentTenant } from "../../features/tenants/useCurrentTenant";

/** One page of an original as an object URL. Fetched through the api client because an
 * <img> cannot send the X-Tenant-Id header; images are their own preview, PDF pages are
 * rendered by the backend (FR-UPLOAD-011). */
export function usePageUrl(fileId: string, page: number): string | null {
  const { tenant } = useCurrentTenant();
  const blob = useQuery({
    queryKey: ["preview", tenant?.tenant_id, fileId, page],
    queryFn: () =>
      call(
        api.GET("/api/v1/files/{file_id}/pages/{page}/preview", {
          params: { path: { file_id: fileId, page } },
          parseAs: "blob",
        }),
      ) as Promise<Blob>,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const url = useMemo(
    () =>
      blob.data && typeof URL.createObjectURL === "function" ? URL.createObjectURL(blob.data) : null,
    [blob.data],
  );
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return url;
}

export function PageImage({ fileId, page = 1, alt, className }: {
  fileId: string;
  page?: number;
  alt: string;
  className?: string;
}) {
  const url = usePageUrl(fileId, page);
  return url ? <img className={className} src={url} alt={alt} /> : <div className={className} aria-label={alt} />;
}
