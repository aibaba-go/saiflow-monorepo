import { useQuery } from "@tanstack/react-query";
import { ImageViewer } from "antd-mobile";
import { useEffect, useMemo, useState } from "react";

import { useT } from "../../i18n";
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

/** The original above a result or before starting: page pills, tap to zoom
 * (main OriginalPreview.vue and ImageViewer.vue; pinch and double-tap come from antd-mobile). */
export function OriginalPreview({ fileId, fileName, pageCount }: {
  fileId: string;
  fileName: string;
  pageCount: number;
}) {
  const t = useT();
  const pages = Math.max(pageCount || 1, 1);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const url = usePageUrl(fileId, page);
  return (
    <section className="original">
      <div className="original__head">
        <span>{t("scan.original")}</span>
        <span className="original__hint">{t("scan.tapZoom")}</span>
      </div>
      {pages > 1 && (
        <div className="original__pager">
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              className={n === page ? "pill pill--active" : "pill"}
              aria-pressed={n === page}
              onClick={() => setPage(n)}
            >
              {n}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="original__frame" aria-label={t("scan.tapZoom")} onClick={() => setOpen(true)}>
        {url ? <img src={url} alt={fileName} /> : <span className="original__blank">{fileName}</span>}
      </button>
      {url && <ImageViewer image={url} visible={open} onClose={() => setOpen(false)} />}
    </section>
  );
}
