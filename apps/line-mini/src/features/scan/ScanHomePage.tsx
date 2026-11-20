import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bell, Building2, Camera, Check, ChevronDown, ChevronRight, FolderOpen, Link2, RefreshCw, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { BrandLoading } from "../../components/BrandLoading";
import { PageImage } from "../../components/OriginalPreview";
import { useT, type MessageKey } from "../../i18n";
import { errorMessage } from "../../services/errors";
import { useSession } from "../../stores/session";
import { formatBangkokDate, formatCount } from "../../utils/format";
import { jobTarget } from "./HistoryPage";
import { useUsage } from "../billing/useUsage";
import { useUnreadCount } from "../notifications/data";
import { can } from "../tenants/permissions";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import { deleteFile, importUrl, listJobs, type FileOut } from "./api";
import { JobListItem } from "./components/JobListItem";
import { pendingKey, usePending } from "./jobs";
import { heldLevels } from "../reviews/api";
import { ReviewEntry } from "../reviews/ReviewEntry";
import s from "./ScanHomePage.module.css";
import theme from "./theme.module.css";
import { formatSize, useUploadQueue, type UploadItem } from "./uploadQueue";
import { recentKey, useHomeRefresh } from "./useHomeRefresh";

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).map((n) => s[n as string] ?? n).join(" ");
const DAY_MS = 24 * 60 * 60 * 1000;

function FileIcon({ image }: { image: boolean }) {
  return image ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M13 2v7h7" />
    </svg>
  );
}

/** main `ScanHomePage.vue` (FR-SYS-056, 057, 058, 109, 110, 111): workspace, plan banners,
 * Camera / Files / URL import, the upload batch, Pending with multi-select, recent tasks. */
export function ScanHomePage() {
  const { tenant } = useCurrentTenant();
  // A tenant switch starts over: the batch, selections and messages belong to the old one.
  return <ScanHome key={tenant?.tenant_id ?? "none"} />;
}

function ScanHome() {
  const t = useT();
  const uid = useId();
  const [now, setNow] = useState(() => Date.now());
  const navigate = useNavigate();
  const client = useQueryClient();
  const me = useSession((st) => st.me);
  const tenants = useSession((st) => st.tenants);
  const { tenant, setTenant } = useCurrentTenant();
  const usage = useUsage();
  const unread = useUnreadCount();
  const pending = usePending();
  const recent = useQuery({
    queryKey: recentKey(tenant?.tenant_id),
    queryFn: () => listJobs({ page: 1, pageSize: 10 }),
    enabled: tenant !== null,
  });
  const refreshPending = () => void client.invalidateQueries({ queryKey: ["files", "pending"] });
  const queue = useUploadQueue(refreshPending);
  const [wsOpen, setWsOpen] = useState(false);
  const [urlMode, setUrlMode] = useState(false);
  const [url, setUrl] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmRow, setConfirmRow] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const inputBusy = queue.busy || urlBusy;
  const isUser = me?.kind === "user";
  const mayUpload = can(tenant, "upload_ocr");
  // Manual refresh (FR-SYS-109): reads only; the batch, URL input and workspace stay as they are.
  const home = useHomeRefresh({
    tenantId: tenant?.tenant_id ?? null,
    isUser,
    review: heldLevels(tenant).length > 0, // exactly when ReviewEntry is shown
    onSettled(fresh) {
      setNow(Date.now()); // the plan's days-left reference
      if (!fresh.has("pending")) return; // the read failed: the old list and choices stay
      const still = new Set((client.getQueryData<FileOut[]>(pendingKey(tenant?.tenant_id)) ?? []).map((f) => f.id));
      setSelected((list) => list.filter((id) => still.has(id)));
    },
  });
  const refreshNote = home.refreshing
    ? t("home.refreshing")
    : home.outcome === "done"
      ? t("home.refreshDone")
      : home.outcome === "partial"
        ? t("home.refreshPartial")
        : "";

  const pendingFiles = pending.data ?? [];
  const selectedPending = pendingFiles.filter((f) => selected.includes(f.id));
  const allSelected = pendingFiles.length > 0 && selectedPending.length === pendingFiles.length;
  const deleteTargets = pendingFiles.filter((f) => deleteIds.includes(f.id));

  const items = queue.items;
  const uploadedCount = items.filter((i) => i.status === "uploaded").length;
  const failedItems = items.filter((i) => i.status === "failed");
  const unfinished = items.filter((i) => i.status === "uploading" || i.status === "waiting").length;
  const position = items.findIndex((i) => i.status === "uploading") + 1;
  const showUploadBox = items.length > 0 || queue.cancelled > 0;
  const visibleItems = queue.busy ? items : failedItems;
  const summary = [
    t("home.batch.uploadedCount", { n: uploadedCount }),
    unfinished ? t("home.batch.remainingCount", { n: unfinished }) : null,
    failedItems.length ? t("home.batch.failedCount", { n: failedItems.length }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Plan banners (main: quota card, expired card, expiring soon).
  const u = usage.data;
  const planLabel = u?.plan ? t(`plan.${u.plan.code}` as MessageKey) : t("sub.notActive");
  const expired = Boolean(u?.plan && !u.active);
  const daysLeft = u?.plan && u.active ? Math.ceil((Date.parse(u.plan.ends_at) - now) / DAY_MS) : null;
  const expiringSoon = daysLeft !== null && daysLeft <= 7;
  const quotaPct = u && u.month.quota > 0 ? Math.min(100, Math.round((u.month.remaining / u.month.quota) * 100)) : 0;

  function tenantName(id: number | null): string {
    if (id === null) return t("home.workspacePersonal");
    return tenants.find((x) => x.tenant_id === id)?.name ?? t("my.company");
  }
  const orgs = tenants.filter((x) => x.kind === "organization");
  const currentOrg = tenant?.kind === "organization" ? tenant.tenant_id : null;

  function picked(input: HTMLInputElement | null) {
    const chosen = Array.from(input?.files ?? []);
    if (input) input.value = "";
    if (!chosen.length || inputBusy) return;
    setWsOpen(false);
    setErrorMsg("");
    setConfirmAll(false);
    setConfirmRow(null);
    queue.start(chosen);
  }

  async function submitUrl() {
    const value = url.trim();
    if (!value || inputBusy) return;
    setUrlBusy(true);
    setWsOpen(false);
    setErrorMsg("");
    try {
      const file = await importUrl(value);
      setUrlMode(false);
      setUrl("");
      refreshPending();
      navigate(`/scan/confirm?ids=${encodeURIComponent(file.id)}`); // main opens the confirm page
    } catch (e) {
      setErrorMsg(errorMessage(e, t));
    } finally {
      setUrlBusy(false);
    }
  }

  function processFiles(ids: string[]) {
    if (deleting) return;
    const ordered = pendingFiles.filter((f) => ids.includes(f.id)).map((f) => f.id);
    if (ordered.length) navigate(`/scan/confirm?ids=${ordered.map(encodeURIComponent).join(",")}`);
  }

  function askDelete(ids: string[]) {
    if (deleting) return;
    const targets = pendingFiles.filter((f) => ids.includes(f.id)).map((f) => f.id);
    if (!targets.length) return;
    setDeleteError("");
    setDeleteIds(targets);
  }

  async function confirmDelete() {
    if (deleting || !deleteTargets.length) return;
    setDeleting(true);
    setDeleteError("");
    let failed = 0;
    let reason = "";
    for (const f of deleteTargets) {
      try {
        await deleteFile(f.id);
        setSelected((list) => list.filter((id) => id !== f.id));
      } catch (e) {
        failed += 1; // the record stays; the user decides whether to delete again
        reason = errorMessage(e, t);
      }
    }
    setDeleteIds([]);
    if (failed) setDeleteError(t("home.pending.deleteFailed", { n: failed, reason }));
    setDeleting(false);
    refreshPending();
  }

  function pagesText(file: FileOut): string {
    const n = file.page_count || 1;
    return n === 1 ? t("home.pending.pageOne") : t("home.pending.pageMany", { n });
  }

  function rowState(item: UploadItem): string {
    if (item.status === "uploading") return `${item.percent}%`;
    return item.status === "waiting" ? t("scan.waiting") : t("scan.uploaded");
  }

  return (
    <div className={`${theme.scan} ${s.home}`}>
      <header className={s["home-header"]}>
        <div className={s.brandmark}>
          <span className={s.wordmark} role="img" aria-label="AIbaba">
            <span className={s["wordmark-ai"]} aria-hidden="true">AI</span>
            <span aria-hidden="true">baba</span>
          </span>
          <span className={s["product-divider"]} aria-hidden="true" />
          <span className={s.product}>
            <span className={s["product-name"]}>SaiFlow</span>
            <span className={s["product-sub"]}>{t("home.productSub")}</span>
          </span>
        </div>
        <div className={s["header-actions"]}>
          <button
            type="button"
            className={s["refresh-btn"]}
            aria-label={home.refreshing ? t("home.refreshing") : t("home.refresh")}
            aria-busy={home.refreshing}
            aria-disabled={home.refreshing || !tenant}
            onClick={() => void home.refresh()}
          >
            <RefreshCw className={s["refresh-icon"]} size={19} strokeWidth={1.9} aria-hidden="true" />
          </button>
          {isUser && (
            <button type="button" className={s.bell} aria-label={t("notify.title")} onClick={() => navigate("/notifications")}>
              <Bell size={21} strokeWidth={1.8} aria-hidden="true" />
              {(unread.data ?? 0) > 0 && <span className={s["bell-dot"]} aria-label={t("notify.hasUnread")} />}
            </button>
          )}
        </div>
      </header>

      <div className={s.content}>
        <div className={s.welcome}>
          {isUser && (
            <div className={s["ws-row"]}>
              <div className={s["ws-switch"]}>
                <button
                  type="button"
                  className={s["ws-pill"]}
                  disabled={inputBusy}
                  aria-expanded={wsOpen}
                  onClick={() => !inputBusy && setWsOpen(!wsOpen)}
                >
                  <Building2 className={s["ws-icon"]} size={15} strokeWidth={1.8} aria-hidden="true" />
                  <span>{tenantName(currentOrg)}</span>
                  <ChevronDown className={cx("ws-chevron", wsOpen && "open")} size={14} strokeWidth={2} aria-hidden="true" />
                </button>
                {wsOpen && <div className={s["ws-menu-backdrop"]} onClick={() => setWsOpen(false)} />}
                {wsOpen && (
                  <div className={s["ws-menu"]} role="menu">
                    {[null, ...orgs.map((o) => o.tenant_id)].map((id) => (
                      <button
                        type="button"
                        role="menuitem"
                        key={id ?? "personal"}
                        className={cx("ws-menu-item", id === currentOrg && "current")}
                        disabled={inputBusy}
                        onClick={() => {
                          setTenant(id);
                          setWsOpen(false);
                        }}
                      >
                        <span className={s["ws-menu-name"]}>{tenantName(id)}</span>
                        {id !== null && <em>{orgs.find((o) => o.tenant_id === id)?.role?.name ?? ""}</em>}
                        {id === currentOrg && <Check className={s["ws-check"]} size={14} strokeWidth={3} aria-hidden="true" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          <span className={s["welcome-label"]} aria-hidden="true">
            {t("home.documentAi")}
          </span>
          <h1 className={s.tagline}>
            {t("home.taglineLead")}
            <span className={s["tagline-accent"]}>{t("home.taglineAccent")}</span>
          </h1>
          <p className={s["tagline-sub"]}>{t("home.taglineSub")}</p>
          {refreshNote && (
            <p
              className={cx("status-line", home.outcome === "partial" && "error")}
              role={home.outcome === "partial" ? "alert" : "status"}
              data-refresh-note=""
            >
              {refreshNote}
            </p>
          )}
        </div>

        {expired && isUser && (
          <div className={s["expired-card"]} role="alert">
            <div className={s["expired-head"]}>
              <span className={s["expired-badge"]}>{t("sub.expired")}</span>
              <span className={s["expired-title"]}>{t("sub.expiredTitle")}</span>
            </div>
            <p className={s["expired-body"]}>{t("sub.expiredBody")}</p>
            <button type="button" className={s["expired-cta"]} onClick={() => navigate("/plans")}>
              {t("sub.expiredCta")}
            </button>
          </div>
        )}

        {u && isUser && (
          <div className={s["quota-card"]}>
            {/* one sentence for screen readers; the visual pieces below repeat it */}
            <span className={s["sr-only"]}>
              {t("home.quotaPages", {
                plan: planLabel,
                left: formatCount(u.month.remaining),
                total: formatCount(u.month.quota),
              })}
            </span>
            <div className={s["quota-top"]} aria-hidden="true">
              <span className={s["quota-label"]}>{t("home.quotaLabel")}</span>
              <span className={s["plan-tag"]}>{planLabel}</span>
            </div>
            <div className={s["quota-row"]}>
              <div className={s["quota-value"]} aria-hidden="true">
                {formatCount(u.month.remaining)}
                <small>{t("home.quotaTotal", { total: formatCount(u.month.quota) })}</small>
              </div>
              <button type="button" className={s["quota-plans"]} onClick={() => navigate("/plans")}>
                {t("home.plansLink")}
              </button>
            </div>
            <div className={s["quota-track"]}>
              <div className={s["quota-fill"]} style={{ width: `${quotaPct}%` }} />
            </div>
            {(u.plan || u.free.remaining > 0) && (
              <div className={s["quota-bottom"]}>
                {u.free.remaining > 0 && (
                  <div className={s["quota-free"]}>
                    <span>{t("usage.free", { n: formatCount(u.free.remaining) })}</span>
                    <span className={s["quota-days"]}>
                      {" · "}
                      {t("home.freeFirst")}
                    </span>
                    {u.free.expires_at && (
                      <span className={s["quota-days"]}>
                        {" · "}
                        {t("usage.freeExpires", { date: formatBangkokDate(u.free.expires_at) })}
                      </span>
                    )}
                  </div>
                )}
                {u.plan && (
                  <div className={cx("quota-expiry", expiringSoon && "warn", expired && "danger")}>
                    <span>{t("sub.validUntil", { date: formatBangkokDate(u.plan.ends_at) })}</span>
                    {daysLeft !== null && (
                      <span className={s["quota-days"]}>
                        {" · "}
                        {daysLeft <= 0 ? t("sub.lastDay") : t("sub.daysLeft", { n: daysLeft })}
                      </span>
                    )}
                    {expiringSoon && <span className={s["quota-soon"]}>{t("sub.expiringSoon")}</span>}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {mayUpload && (
          <>
            <button
              type="button"
              className={s["entry-card"]}
              disabled={inputBusy}
              aria-labelledby={`${uid}-scan`}
              aria-describedby={`${uid}-scan-sub`}
              onClick={() => camera.current?.click()}
            >
              <span className={s["entry-icon"]} aria-hidden="true">
                <Camera size={25} strokeWidth={1.7} />
              </span>
              <span className={s["scan-text"]}>
                <span id={`${uid}-scan`} className={s["scan-title"]}>
                  {t("home.scanTitle")}
                </span>
                <span id={`${uid}-scan-sub`} className={s["scan-sub"]}>
                  {t("home.cameraSub")}
                </span>
              </span>
              <ArrowRight className={s["scan-arrow"]} size={20} strokeWidth={1.9} aria-hidden="true" />
            </button>
            <input ref={camera} data-testid="scan-camera" type="file" accept="image/jpeg,image/png" capture="environment" disabled={inputBusy} hidden onChange={(e) => picked(e.currentTarget)} />
            <input ref={files} data-testid="scan-files" type="file" multiple disabled={inputBusy} hidden onChange={(e) => picked(e.currentTarget)} />

            <div className={s["scan-methods"]}>
              <button type="button" className={s.method} disabled={inputBusy} onClick={() => files.current?.click()}>
                <FolderOpen size={17} strokeWidth={1.8} aria-hidden="true" />
                <span>{t("home.files")}</span>
              </button>
              <button
                type="button"
                className={cx("method", urlMode && "active")}
                disabled={inputBusy}
                aria-expanded={urlMode}
                onClick={() => setUrlMode(true)}
              >
                <Link2 size={17} strokeWidth={1.8} aria-hidden="true" />
                <span>{t("home.importUrl")}</span>
              </button>
            </div>

            {urlMode && (
              <div className={s["url-editor"]}>
                <input
                  className={s["url-input"]}
                  aria-label={t("home.importUrl")}
                  value={url}
                  placeholder={t("home.urlPlaceholder")}
                  disabled={inputBusy}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyUp={(e) => e.key === "Enter" && void submitUrl()}
                />
                <button type="button" className={cx("url-submit", urlBusy && "busy")} disabled={inputBusy || !url.trim()} onClick={() => void submitUrl()}>
                  {urlBusy ? <BrandLoading variant="inline" label={t("common.loading")} /> : t("home.urlSubmit")}
                </button>
              </div>
            )}
          </>
        )}

        <ReviewEntry />

        {showUploadBox && (
          <section className={s["upload-box"]} aria-label={queue.busy ? t("home.batch.title") : t("home.batch.finished")}>
            {queue.busy ? (
              <>
                <div className={s["upload-head"]}>
                  <div className={s["upload-title"]}>
                    <span>{t("home.batch.title")}</span>
                    <div className={s["upload-actions"]}>
                      <span className={s["upload-counter"]}>
                        {t("home.batch.position", { n: position || uploadedCount, total: items.length })}
                      </span>
                      <button
                        type="button"
                        className={s["cancel-all"]}
                        aria-label={t("home.batch.cancelAllLabel")}
                        aria-expanded={confirmAll}
                        disabled={!unfinished}
                        onClick={() => {
                          setConfirmRow(null);
                          setConfirmAll(true);
                        }}
                      >
                        {t("home.batch.cancelAll")}
                      </button>
                    </div>
                  </div>
                  <div className={s["upload-meta"]}>{summary}</div>
                  <div className={s.segments} aria-hidden="true">
                    {items.map((item) => (
                      <div key={item.key} className={cx("segment", item.status === "failed" && "error")}>
                        <span style={{ width: `${item.percent}%` }} />
                      </div>
                    ))}
                  </div>
                  <span className={s["sr-only"]} role="status" aria-live="polite">
                    {position ? t("home.batch.status", { n: position, total: items.length }) : ""}
                  </span>
                </div>
                {confirmAll && (
                  <div className={s["inline-confirm"]} role="alertdialog" aria-label={t("home.batch.cancelAllTitle")}>
                    <p className={s["confirm-title"]}>{t("home.batch.cancelAllTitle")}</p>
                    <p className={s["confirm-body"]}>{t("home.batch.cancelAllBody", { n: unfinished, m: uploadedCount })}</p>
                    <div className={s["confirm-actions"]}>
                      <button type="button" className={s["confirm-keep"]} onClick={() => setConfirmAll(false)}>
                        {t("home.batch.keepUploading")}
                      </button>
                      <button
                        type="button"
                        className={s["confirm-danger"]}
                        onClick={() => {
                          setConfirmAll(false);
                          queue.cancelAll();
                        }}
                      >
                        {t("home.batch.cancelAllConfirm", { n: unfinished })}
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : queue.cancelled ? (
              <div className={cx("batch-note", "cancelled")} role="status">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="4" y="4" width="16" height="16" rx="3" />
                  <path d="M9 9l6 6M15 9l-6 6" />
                </svg>
                <p>
                  {queue.cancelAllUsed ? t("home.batch.allCancelled") : t("home.batch.finished")}
                  <small>{t("home.batch.cancelledSummary", { n: queue.cancelled, m: uploadedCount })}</small>
                </p>
              </div>
            ) : !failedItems.length ? (
              <div className={cx("batch-note", "done")} role="status">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 12l5 5L20 6" />
                </svg>
                <p>
                  {uploadedCount === 1 ? t("home.batch.doneOne") : t("home.batch.doneMany", { n: uploadedCount })}
                  <small>{t("home.batch.readyInPending")}</small>
                </p>
              </div>
            ) : (
              <div className={s["upload-head"]}>
                <div className={s["upload-title"]}>
                  <span>{t("home.batch.finished")}</span>
                  <span className={s["upload-counter"]}>{t("home.batch.uploadedOf", { n: uploadedCount, total: items.length })}</span>
                </div>
                <div className={s["upload-meta"]}>{summary}</div>
              </div>
            )}
            {visibleItems.map((item) => (
              <div key={item.key}>
                <div className={cx("upload-row", item.status === "failed" && "failed")} data-upload={item.name}>
                  <div className={s["file-icon"]} aria-hidden="true">
                    <FileIcon image={item.image} />
                  </div>
                  <div className={s["file-body"]}>
                    <div className={s["file-name"]} title={item.name}>{item.name}</div>
                    <div className={s["file-meta"]}>
                      <span>
                        {formatSize(item.size)} · {item.format}
                      </span>
                    </div>
                    {item.status === "uploading" && (
                      <div className={s["file-progress"]} role="progressbar" aria-label={item.name} aria-valuenow={item.percent} aria-valuemin={0} aria-valuemax={100}>
                        <span style={{ width: `${item.percent}%` }} />
                      </div>
                    )}
                    {item.status === "failed" && Boolean(item.error) && (
                      <p className={s["row-error"]} role="alert">
                        {t("home.upload.failed")} · {errorMessage(item.error, t)}
                      </p>
                    )}
                  </div>
                  <div className={s["row-end"]}>
                    {item.status !== "failed" && <span className={cx("row-state", item.status)}>{rowState(item)}</span>}
                    {queue.canRetry(item) && (
                      <button type="button" className={s["row-retry"]} aria-label={t("home.batch.retryFile", { name: item.name })} disabled={urlBusy} onClick={() => queue.retry(item.key)}>
                        {t("home.batch.retry")}
                      </button>
                    )}
                    {(item.status === "failed" || (queue.busy && (item.status === "uploading" || item.status === "waiting"))) && (
                      <button
                        type="button"
                        className={cx("row-cancel", item.status === "uploading" && "active")}
                        aria-label={t("home.batch.cancelFile", { name: item.name })}
                        onClick={() => {
                          if (item.status === "uploading") setConfirmRow(item.key);
                          else queue.cancel(item.key); // waiting or failed: no confirmation
                        }}
                      >
                        {t("home.batch.cancel")}
                      </button>
                    )}
                  </div>
                </div>
                {confirmRow === item.key && item.status === "uploading" && (
                  <div className={cx("inline-confirm", "row-confirm")} role="alertdialog" aria-label={t("home.batch.cancelOneTitle")}>
                    <p className={s["confirm-title"]}>{t("home.batch.cancelOneTitle")}</p>
                    <p className={s["confirm-body"]}>{t("home.batch.cancelOneBody")}</p>
                    <div className={s["confirm-actions"]}>
                      <button type="button" className={s["confirm-keep"]} onClick={() => setConfirmRow(null)}>
                        {t("home.batch.keepUploading")}
                      </button>
                      <button
                        type="button"
                        className={s["confirm-danger"]}
                        onClick={() => {
                          setConfirmRow(null);
                          queue.cancel(item.key);
                        }}
                      >
                        {t("home.batch.cancelUpload")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {queue.busy ? (
              <div className={s["upload-foot"]}>
                <span>{t("home.batch.hint")}</span>
              </div>
            ) : failedItems.length ? (
              <div className={s["upload-foot"]}>
                <span>{t("home.batch.failedHint")}</span>
                {failedItems.some(queue.canRetry) && (
                  <button type="button" className={s["retry-btn"]} onClick={queue.retryFailed}>
                    {t("home.batch.retryFailed")}
                  </button>
                )}
              </div>
            ) : null}
          </section>
        )}
        {errorMsg && (
          <p className={cx("status-line", "error")} role="alert">
            {errorMsg}
          </p>
        )}

        <section className={s["pending-section"]} aria-label={t("home.pending.title")}>
          <div className={s["section-head"]}>
            <h2 className={s["section-title"]}>
              {t("home.pending.title")}
              <span className={s["count-badge"]}>{pendingFiles.length}</span>
            </h2>
            <span className={s["section-hint"]}>{t("home.pending.hint")}</span>
          </div>
          {deleteTargets.length > 0 && (
            <div className={cx("inline-confirm", "delete-confirm")} role="alertdialog" aria-label={t("home.pending.deleteTitleOne")}>
              <p className={s["confirm-title"]}>
                {deleteTargets.length === 1
                  ? t("home.pending.deleteTitleOne")
                  : t("home.pending.deleteTitleMany", { n: deleteTargets.length })}
              </p>
              <ul className={s["delete-names"]}>
                {deleteTargets.map((f) => (
                  <li key={f.id}>{f.original_name}</li>
                ))}
              </ul>
              <p className={s["confirm-body"]}>{t("home.pending.deleteBody")}</p>
              <div className={s["confirm-actions"]}>
                <button type="button" className={s["confirm-keep"]} disabled={deleting} onClick={() => setDeleteIds([])}>
                  {t("home.pending.keepRecords")}
                </button>
                <button type="button" className={cx("confirm-danger", deleting && "busy")} disabled={deleting} onClick={() => void confirmDelete()}>
                  {deleting ? (
                    <BrandLoading variant="inline" label={t("common.loading")} />
                  ) : (
                    t("home.pending.deleteConfirm", { n: deleteTargets.length })
                  )}
                </button>
              </div>
            </div>
          )}
          {deleteError && (
            <p className={cx("status-line", "error")} role="alert">
              {deleteError}
            </p>
          )}
          <div className={s["pending-box"]}>
            {pending.isPending ? (
              <div className={s["pending-state"]}>
                <BrandLoading variant="inline" label={t("common.loading")} />
              </div>
            ) : pending.isError && pending.data === undefined ? (
              <p className={cx("pending-state", "status-line", "error")}>{errorMessage(pending.error, t)}</p>
            ) : !pendingFiles.length ? (
              <div className={cx("pending-state", "pending-empty")}>
                {t("home.pending.emptyTitle")}
                <br />
                {t("home.pending.emptyBody")}
              </div>
            ) : (
              <>
                {pendingFiles.map((file) => (
                  <div key={file.id} className={cx("pending-card", selected.includes(file.id) && "chosen")} data-pending={file.original_name}>
                    <div className={s["pending-main"]}>
                      <label className={s.check}>
                        <input
                          type="checkbox"
                          checked={selected.includes(file.id)}
                          aria-label={t("home.pending.select", { name: file.original_name })}
                          onChange={() =>
                            setSelected((list) => (list.includes(file.id) ? list.filter((id) => id !== file.id) : [...list, file.id]))
                          }
                        />
                      </label>
                      <div className={s["pending-thumb"]} aria-hidden="true">
                        {/* A thumbnail where main shows a file icon (FR-SYS-058, 111). */}
                        <PageImage className={s.thumb} fileId={file.id} alt={file.original_name} />
                      </div>
                      <div className={s["file-body"]}>
                        <div className={s["pending-name"]} title={file.original_name}>
                          {file.original_name}
                        </div>
                        <div className={s["pending-meta"]}>
                          <span>{pagesText(file)}</span>
                          {file.size_bytes ? <span>{formatSize(file.size_bytes)}</span> : null}
                          <span className={s["pending-badge"]}>{t("home.pending.badge")}</span>
                        </div>
                      </div>
                    </div>
                    <div className={s["pending-actions"]}>
                      <button type="button" className={s["trash-btn"]} disabled={deleting} aria-label={t("home.pending.deleteName", { name: file.original_name })} onClick={() => askDelete([file.id])}>
                        <Trash2 size={15} strokeWidth={1.9} aria-hidden="true" />
                        <span aria-hidden="true">{t("common.delete")}</span>
                      </button>
                      <button type="button" className={s["process-btn"]} disabled={deleting} aria-label={t("home.pending.processName", { name: file.original_name })} onClick={() => processFiles([file.id])}>
                        <span aria-hidden="true">{t("home.pending.preview")}</span>
                        <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
                <div className={s["batch-bar"]}>
                  <div className={s["batch-top"]}>
                    <span className={s["batch-selected"]}>{t("home.pending.selected", { n: selectedPending.length })}</span>
                    <button
                      type="button"
                      className={s["select-all"]}
                      disabled={!pendingFiles.length || deleting}
                      onClick={() => setSelected(allSelected ? [] : pendingFiles.map((f) => f.id))}
                    >
                      {allSelected ? t("home.pending.deselectAll") : t("home.pending.selectAll")}
                    </button>
                  </div>
                  <div className={s["batch-actions"]}>
                    <button type="button" className={s["bulk-delete"]} disabled={!selectedPending.length || deleting} onClick={() => askDelete(selected)}>
                      {selectedPending.length ? t("home.pending.deleteN", { n: selectedPending.length }) : t("home.pending.deleteSelected")}
                    </button>
                    <button type="button" className={s["bulk-process"]} disabled={!selectedPending.length || deleting} onClick={() => processFiles(selected)}>
                      {selectedPending.length ? t("home.pending.processN", { n: selectedPending.length }) : t("home.pending.processSelected")}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        <div className={cx("section-head", "recent-head")}>
          <h2 className={s["section-title"]}>{t("home.recent")}</h2>
          <button type="button" className={s["section-link"]} onClick={() => navigate("/history")}>
            {t("home.recentAll")}
          </button>
        </div>
        {recent.isPending ? (
          <div className={s["status-line"]}>
            <BrandLoading variant="inline" label={t("common.loading")} />
          </div>
        ) : !recent.data?.items.length ? (
          <div className={s["status-line"]}>{t("history.empty")}</div>
        ) : (
          <div className={s["task-list"]}>
            {recent.data.items.map((job) => (
              <JobListItem key={job.id} job={job} onOpen={(j) => navigate(jobTarget(j))} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
