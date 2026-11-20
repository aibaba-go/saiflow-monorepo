import { useQuery } from "@tanstack/react-query";
import { Button, Image, Tooltip } from "antd";
import { useEffect, useMemo, useState } from "react";

import { useT } from "../i18n";
import { Icon } from "../layout/icons";
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

const ZOOMS = [50, 75, 100, 125, 150, 200];
const pad = (n: number) => String(n).padStart(2, "0");

/** The original, page by page (FR-SYS-124), in the prototype's viewer: a toolbar with the
 * zoom (client side only), the page on a dotted paper area, and the page / file line. The
 * image still opens the full preview with its own zoom. */
export function OriginalPages({ fileId, fileName, pageCount }: { fileId: string; fileName: string; pageCount: number }) {
  const t = useT();
  const pages = Math.max(pageCount || 1, 1);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const url = usePageUrl(fileId, page);
  const at = ZOOMS.indexOf(zoom);
  return (
    <div className="pc-viewer">
      <div className="pc-viewer__toolbar">
        <span className="pc-viewer__title">
          <Icon name="file" />
          {t("viewer.title")}
        </span>
        <span className="pc-viewer__controls">
          <Tooltip title={t("viewer.zoomOut")}>
            <Button
              type="text"
              size="small"
              aria-label={t("viewer.zoomOut")}
              icon={<Icon name="minus" />}
              disabled={at <= 0}
              onClick={() => setZoom(ZOOMS[at - 1]!)}
            />
          </Tooltip>
          <span className="pc-viewer__zoom num" aria-label={t("viewer.zoom")}>
            {zoom}%
          </span>
          <Tooltip title={t("viewer.zoomIn")}>
            <Button
              type="text"
              size="small"
              aria-label={t("viewer.zoomIn")}
              icon={<Icon name="plus" />}
              disabled={at >= ZOOMS.length - 1}
              onClick={() => setZoom(ZOOMS[at + 1]!)}
            />
          </Tooltip>
          <Tooltip title={t("viewer.zoomReset")}>
            <Button
              type="text"
              size="small"
              aria-label={t("viewer.zoomReset")}
              icon={<Icon name="expand" />}
              disabled={zoom === 100}
              onClick={() => setZoom(100)}
            />
          </Tooltip>
        </span>
      </div>
      <div className="pc-viewer__paper">
        <div className="pc-viewer__sheet" style={{ width: `${zoom}%` }}>
          {url ? (
            <Image src={url} alt={fileName} width="100%" />
          ) : (
            <div aria-label={fileName} className="pc-original__placeholder" />
          )}
        </div>
      </div>
      <div className="pc-viewer__foot">
        {pages > 1 && (
          <Button size="small" type="text" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t("review.prevPage")}
          </Button>
        )}
        <span className="pc-viewer__where">
          <span className="num">{t("viewer.page", { n: pad(page), total: pad(pages) })}</span>
          <span aria-hidden="true"> · </span>
          <span className="pc-viewer__file">{fileName}</span>
        </span>
        {pages > 1 && (
          <Button size="small" type="text" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            {t("review.nextPage")}
          </Button>
        )}
      </div>
    </div>
  );
}
