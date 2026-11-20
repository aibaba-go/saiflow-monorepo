import { useT } from "../../../i18n";
import { formatBangkokDateTime } from "../../../utils/format";
import type { JobOut } from "../jobs";
import s from "./JobListItem.module.css";
import { StatusChip } from "./StatusChip";

/** The file's format label on the thumbnail (prototype .doc-thumbnail "PDF"). */
export function formatLabel(name: string | null | undefined): string {
  const ext = /\.([a-z0-9]{2,4})$/i.exec(name ?? "")?.[1];
  return ext ? ext.toUpperCase() : "";
}

/** The prototype's document thumbnail: a page icon with the format label under it. */
export function DocThumb({ name, className }: { name?: string | null; className?: string }) {
  const label = formatLabel(name);
  // the thumbnail's colour by kind (FR-SYS-132): PDF rose, images cyan, others indigo
  const kind = label === "PDF" ? "pdf" : /^(JPE?G|PNG|WEBP|HEIC|GIF|BMP|TIFF?)$/.test(label) ? "image" : "other";
  return (
    <span className={[s.icon, className].filter(Boolean).join(" ")} data-kind={kind} aria-hidden="true">
      <svg width="15" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
        <path d="M14 2v6h6" />
      </svg>
      {label && <span className={s.format}>{label}</span>}
    </span>
  );
}

/** main `JobListItem.vue` as the prototype .job row: thumbnail, name, "template · pages",
 * then the status chip on the left and the Bangkok time on the right. main's meta line also
 * counts tables; our job list has no table count. */
export function JobListItem({ job, onOpen }: { job: JobOut; onOpen(job: JobOut): void }) {
  const t = useT();
  const pages =
    job.page_count === 1 ? t("home.pending.pageOne") : t("home.pending.pageMany", { n: job.page_count });
  const time = formatBangkokDateTime(job.created_at).slice(11);
  return (
    <button type="button" className={s.card} data-job={job.id} onClick={() => onOpen(job)}>
      <DocThumb name={job.file_name} />
      <span className={s.main}>
        <span className={s.name}>{job.file_name || "—"}</span>
        <span className={s.meta}>
          {job.template_name && <span className={s.template}>{job.template_name}</span>}
          <span className={s.pages}>{pages}</span>
        </span>
        <span className={s.bottom}>
          <StatusChip stage={job.stage} level={job.review_level} returned={job.returned} />
          <span className={s.end}>
            <span className={s.time}>{time}</span>
            <svg className={s.chevron} aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </span>
        </span>
      </span>
    </button>
  );
}
