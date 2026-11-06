import { useState } from "react";

import { usePageUrl } from "../../../components/OriginalPreview";
import { useT } from "../../../i18n";
import { ImageViewer } from "./ImageViewer";
import s from "./OriginalPreview.module.css";

/** main `OriginalPreview.vue`: the original above a result, page pills, tap to open the
 * full-screen viewer (FR-SYS-105, 113). */
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
    <section className={s["original-card"]}>
      <div className={s["original-head"]}>
        <span className={s["original-title"]}>{t("result.original")}</span>
        <span className={s["original-hint"]}>{t("result.tapZoom")}</span>
      </div>
      {pages > 1 && (
        <div className={s.pager}>
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <button
              type="button"
              key={n}
              className={[s["page-pill"], n === page && s.active].filter(Boolean).join(" ")}
              aria-pressed={n === page}
              onClick={() => setPage(n)}
            >
              {n}
            </button>
          ))}
        </div>
      )}
      <button type="button" className={s["original-frame"]} aria-label={t("result.tapZoom")} onClick={() => setOpen(true)}>
        {url ? <img className={s.original} src={url} alt={fileName} /> : <span className={s.original} />}
        <span className={s["zoom-badge"]}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5M8 11h6M11 8v6" />
          </svg>
        </span>
      </button>
      {open && (
        <ImageViewer
          fileId={fileId}
          pages={pages}
          index={page - 1}
          alt={fileName}
          onIndex={(i) => setPage(i + 1)}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}
