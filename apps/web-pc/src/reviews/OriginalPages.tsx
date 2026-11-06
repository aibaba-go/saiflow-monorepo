import { useQuery } from "@tanstack/react-query";
import { Button, Image, Space, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";

import { useT } from "../i18n";
import { api, call } from "../services/api";
import { useTenant } from "../tenants/useTenant";

/** One page of an original as an object URL, through the api client so the tenant header
 * is sent (ported from apps/line-mini usePageUrl). */
function usePageUrl(fileId: string, page: number): string | null {
  const { tenant } = useTenant();
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
    () => (blob.data && typeof URL.createObjectURL === "function" ? URL.createObjectURL(blob.data) : null),
    [blob.data],
  );
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}

/** The original, page by page, with zoom in a preview (FR-SYS-124). */
export function OriginalPages({ fileId, fileName, pageCount }: { fileId: string; fileName: string; pageCount: number }) {
  const t = useT();
  const pages = Math.max(pageCount || 1, 1);
  const [page, setPage] = useState(1);
  const url = usePageUrl(fileId, page);
  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      {url ? (
        <Image src={url} alt={fileName} style={{ maxWidth: "100%" }} />
      ) : (
        <div aria-label={fileName} style={{ height: 320, background: "#f5f5f5" }} />
      )}
      {pages > 1 && (
        <Space>
          <Button size="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t("review.prevPage")}
          </Button>
          <Typography.Text>
            {page} / {pages}
          </Typography.Text>
          <Button size="small" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            {t("review.nextPage")}
          </Button>
        </Space>
      )}
    </Space>
  );
}
