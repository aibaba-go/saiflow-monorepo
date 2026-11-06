import { useQueryClient } from "@tanstack/react-query";
import { Button, Card, List } from "antd-mobile";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { ErrorText } from "../../components/ErrorText";
import { PageImage } from "../../components/OriginalPreview";
import { useT } from "../../i18n";
import { confirmAction } from "../../utils/confirm";
import { usePending } from "./jobs";
import { deletePending } from "./upload";

/** The user's own pending originals in the current tenant (FR-SYS-058): name, pages and a
 * thumbnail; delete after a confirmation; open one, or all, in the confirm page. */
export function PendingList() {
  const t = useT();
  const navigate = useNavigate();
  const client = useQueryClient();
  const pending = usePending();
  const [error, setError] = useState<unknown>(null);
  const files = pending.data ?? [];
  if (pending.isError || !files.length) return null; // the scan entry stays usable

  async function remove(id: string, name: string) {
    if (!(await confirmAction(t, t("scan.deleteTitle", { name })))) return;
    setError(null);
    try {
      await deletePending(id);
    } catch (e) {
      setError(e);
    }
    await client.invalidateQueries({ queryKey: ["files", "pending"] });
  }

  const open = (ids: string[]) =>
    navigate(`/scan/confirm?ids=${ids.map(encodeURIComponent).join(",")}`);
  return (
    <Card
      title={t("scan.pending")}
      extra={
        files.length > 1 && (
          <Button
            size="mini"
            color="primary"
            fill="outline"
            onClick={() => open(files.map((f) => f.id))}
          >
            {t("scan.openAll", { n: files.length })}
          </Button>
        )
      }
    >
      <ErrorText error={error} />
      <List>
        {files.map((file) => (
          <List.Item
            key={file.id}
            data-pending={file.original_name}
            prefix={
              <PageImage className="pending__thumb" fileId={file.id} alt={file.original_name} />
            }
            description={t("scan.pages", { n: file.page_count ?? 1 })}
            extra={
              <Button
                size="mini"
                fill="none"
                aria-label={`${t("common.delete")} ${file.original_name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(file.id, file.original_name);
                }}
              >
                {t("common.delete")}
              </Button>
            }
            onClick={() => open([file.id])}
          >
            {file.original_name}
          </List.Item>
        ))}
      </List>
    </Card>
  );
}
