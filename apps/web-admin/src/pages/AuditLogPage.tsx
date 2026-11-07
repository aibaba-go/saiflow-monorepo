import type { components } from "@saiflow/api-client";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, DatePicker, Form, Input, Select, Space, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import { useState } from "react";

import { ErrorText } from "../components/ErrorText";
import { fieldErrorText } from "../components/FieldError";
import { Page } from "../components/Page";
import { formatTime, toBangkokIso } from "../format";
import { isMessageKey, type MessageKey, useT } from "../i18n";
import { api, call } from "../services/api";

type Entry = components["schemas"]["AuditEntryOut"];

const ACTOR_TYPES = ["user", "guest", "admin", "system"] as const;
const PAGE_SIZE = 50;

interface Filters {
  since?: string;
  until?: string;
  actor_type?: string;
  action_prefix?: string;
  target_type?: string;
  target_id?: string;
}

/** The operation log, newest first, read-only, with filters and older pages (FR-SYS-071). */
export function AuditLogPage() {
  const t = useT();
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [actorType, setActorType] = useState<string | undefined>();
  const [action, setAction] = useState("");
  const [targetType, setTargetType] = useState("");
  const [targetId, setTargetId] = useState("");
  const [applied, setApplied] = useState<Filters>({});
  const [before, setBefore] = useState<number | null>(null);
  // cursors of the pages before the current one, for "Previous"
  const [history, setHistory] = useState<number[]>([]);

  const page = useQuery({
    queryKey: ["audit-log", applied, before],
    queryFn: () =>
      call(
        api.GET("/api/v1/admin/audit-log", {
          params: {
            query: { ...applied, limit: String(PAGE_SIZE), ...(before ? { before: String(before) } : {}) },
          },
        }),
      ),
  });

  function search() {
    const f: Filters = {};
    if (range?.[0]) f.since = toBangkokIso(range[0]);
    // the end is exclusive on the server: send the start of the next minute, so the
    // selected minute is included (minor-fixes-ui)
    if (range?.[1]) f.until = toBangkokIso(range[1].startOf("minute").add(1, "minute"));
    if (actorType) f.actor_type = actorType;
    if (action.trim()) f.action_prefix = action.trim();
    if (targetType.trim()) f.target_type = targetType.trim();
    if (targetId.trim()) f.target_id = targetId.trim();
    setApplied(f);
    setBefore(null);
    setHistory([]);
  }

  const item = (field: string, also?: string) => {
    const msg = fieldErrorText(page.error, field, t) || (also ? fieldErrorText(page.error, also, t) : null);
    return { validateStatus: msg ? ("error" as const) : undefined, help: msg };
  };

  const columns: ColumnsType<Entry> = [
    { title: t("log.time"), key: "time", render: (_, e) => formatTime(e.occurred_at) },
    {
      title: t("log.actor"),
      key: "actor",
      render: (_, e) => {
        const kind = isMessageKey(`actor.${e.actor_type}`) ? t(`actor.${e.actor_type}` as MessageKey) : e.actor_type;
        return e.actor_id ? `${kind} #${e.actor_id}` : kind;
      },
    },
    { title: t("log.action"), dataIndex: "action" },
    { title: t("log.target"), key: "target", render: (_, e) => (e.target_id ? `${e.target_type} #${e.target_id}` : e.target_type) },
    {
      title: t("log.result"),
      key: "result",
      render: (_, e) => (isMessageKey(`log.result.${e.result}`) ? t(`log.result.${e.result}` as MessageKey) : e.result),
    },
  ];

  return (
    <Page title={t("nav.auditLog")}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Card>
          <Form layout="vertical" onFinish={search}>
            <Space wrap align="start">
              <Form.Item label={t("log.range")} {...item("since", "until")}>
                <DatePicker.RangePicker showTime allowEmpty={[true, true]} value={range} onChange={setRange} />
              </Form.Item>
              <Form.Item label={t("log.actorType")} htmlFor="log-actor-type">
                <Select
                  id="log-actor-type"
                  allowClear
                  placeholder={t("log.any")}
                  value={actorType}
                  onChange={setActorType}
                  style={{ width: 140 }}
                  options={ACTOR_TYPES.map((a) => ({ value: a, label: t(`actor.${a}`) }))}
                />
              </Form.Item>
              <Form.Item label={t("log.action")} htmlFor="log-action" extra={t("log.actionHint")} {...item("action_prefix")}>
                <Input id="log-action" maxLength={64} value={action} onChange={(e) => setAction(e.target.value)} />
              </Form.Item>
              <Form.Item label={t("log.targetType")} htmlFor="log-target-type" {...item("target_type")}>
                <Input id="log-target-type" maxLength={64} value={targetType} onChange={(e) => setTargetType(e.target.value)} />
              </Form.Item>
              <Form.Item label={t("log.targetId")} htmlFor="log-target-id" {...item("target_id")}>
                <Input id="log-target-id" maxLength={128} value={targetId} onChange={(e) => setTargetId(e.target.value)} />
              </Form.Item>
            </Space>
            <Button type="primary" htmlType="submit">
              {t("log.search")}
            </Button>
          </Form>
        </Card>
        <ErrorText error={page.error} />
        <Table<Entry>
          rowKey="id"
          loading={page.isFetching}
          dataSource={page.data?.items ?? []}
          columns={columns}
          pagination={false}
          scroll={{ x: true }}
        />
        <Space>
          <Button
            disabled={before === null}
            onClick={() => {
              setBefore(null);
              setHistory([]);
            }}
          >
            {t("log.first")}
          </Button>
          <Button
            disabled={before === null}
            onClick={() => {
              setBefore(history.length ? history[history.length - 1]! : null);
              setHistory(history.slice(0, -1));
            }}
          >
            {t("log.previous")}
          </Button>
          <Button
            disabled={!page.data?.next_before}
            onClick={() => {
              if (before !== null) setHistory([...history, before]);
              setBefore(page.data!.next_before!);
            }}
          >
            {t("log.next")}
          </Button>
        </Space>
      </Space>
    </Page>
  );
}
