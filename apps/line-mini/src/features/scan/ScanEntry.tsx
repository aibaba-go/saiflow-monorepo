import { useQueryClient } from "@tanstack/react-query";
import { Button, Card, ProgressBar } from "antd-mobile";
import { useRef, useState } from "react";

import { useT } from "../../i18n";
import { errorMessage } from "../../services/errors";
import { can } from "../tenants/permissions";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import { MAX_FILES, uploadFile } from "./upload";

interface Item {
  key: number;
  name: string;
  status: "waiting" | "uploading" | "uploaded" | "failed";
  percent: number;
  error: unknown;
}

let nextKey = 0;

/** Camera or files, up to 10, uploaded one by one into Pending; never auto-started
 * (FR-SYS-057). Hidden from members without upload_ocr (AC-057-02). */
export function ScanEntry() {
  const t = useT();
  const { tenant } = useCurrentTenant();
  const client = useQueryClient();
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [trimmed, setTrimmed] = useState(false);
  if (!can(tenant, "upload_ocr")) return null;

  const patch = (key: number, change: Partial<Item>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...change } : i)));

  async function picked(input: HTMLInputElement | null) {
    const all = Array.from(input?.files ?? []);
    if (input) input.value = "";
    if (!all.length || busy) return;
    const files = all.slice(0, MAX_FILES);
    setTrimmed(all.length > MAX_FILES);
    const queue = files.map((file) => ({ file, key: ++nextKey }));
    setItems(
      queue.map(({ file, key }) => ({ key, name: file.name, status: "waiting", percent: 0, error: null })),
    );
    setBusy(true);
    try {
      for (const { file, key } of queue) {
        patch(key, { status: "uploading" });
        try {
          await uploadFile(file, (percent) => patch(key, { percent }));
          patch(key, { status: "uploaded", percent: 100 });
        } catch (error) {
          patch(key, { status: "failed", error });
        }
        void client.invalidateQueries({ queryKey: ["files", "pending"] });
      }
    } finally {
      setBusy(false);
    }
  }

  const done = items.filter((i) => i.status === "uploaded" || i.status === "failed").length;
  return (
    <Card title={t("scan.title")}>
      <div className="scan__buttons">
        <Button color="primary" disabled={busy} onClick={() => camera.current?.click()}>
          {t("scan.camera")}
        </Button>
        <Button disabled={busy} onClick={() => picker.current?.click()}>
          {t("scan.files")}
        </Button>
      </div>
      <div className="usage__hint">{t("scan.hint", { n: MAX_FILES })}</div>
      <input
        ref={camera}
        data-testid="scan-camera"
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => void picked(e.currentTarget)}
      />
      <input
        ref={picker}
        data-testid="scan-files"
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        multiple
        hidden
        onChange={(e) => void picked(e.currentTarget)}
      />
      {trimmed && <div className="usage__hint">{t("scan.tooMany", { n: MAX_FILES })}</div>}
      {items.length > 0 && (
        <ul className="scan__queue">
          {busy && <li className="usage__hint">{t("scan.progress", { done, total: items.length })}</li>}
          {items.map((item) => (
            <li key={item.key} data-upload={item.name} className="scan__item">
              <span className="scan__name">{item.name}</span>
              {item.status === "uploading" && <ProgressBar percent={item.percent} />}
              {item.status === "waiting" && <span className="usage__hint">{t("scan.waiting")}</span>}
              {item.status === "uploaded" && <span className="scan__ok">{t("scan.uploaded")}</span>}
              {item.status === "failed" && (
                <span role="alert" className="field-error">
                  {errorMessage(item.error, t)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
