import { Alert, Button, Checkbox, Form, Input, InputNumber, Modal, Space, Table, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import type { SourceRelation, TableResult } from "./reportTypes";

export interface SourceMetadata {
  id: string; name: string; kind: "template" | "postgresql" | "system_pg";
  host?: string | null; port?: number | null; database?: string | null; username?: string | null;
  enabled: boolean; password_configured: boolean;
}
export interface SourceInput {
  name: string; host: string; port: number; database: string; username: string;
  password: string; ssl_mode: "verify-full"; enabled: boolean;
}
export interface DataSourceApi {
  list(signal: AbortSignal): Promise<{ items: SourceMetadata[] }>;
  save(body: SourceInput, id?: string): Promise<SourceMetadata>;
  remove(id: string): Promise<unknown>;
  test(id: string, signal: AbortSignal): Promise<{ ok: boolean }>;
  query(id: string, sql: string, page: number, signal: AbortSignal): Promise<TableResult>;
  tables?(id: string, signal: AbortSignal): Promise<{ items: SourceRelation[] }>;
}
type SourceRow = SourceMetadata | { id: string; name: string; kind: "system_notice" };

const EN = {
  managed: "System managed", systemNotice: "Display only · Not editable",
  add: "Add PostgreSQL source", name: "Source name", host: "Host", port: "Port", database: "Database", username: "Username", password: "Password", keep: "Leave blank to keep the saved password.", enabled: "Enabled", type: "Type", template: "Document template", system: "Built-in PostgreSQL", edit: "Edit", remove: "Delete", removeTitle: "Delete this data source?", removeHelp: "Sources referenced by report drafts or publications cannot be deleted.", save: "Save", cancel: "Cancel", test: "Test connection", connected: "Connection successful", query: "Query", run: "Run query", close: "Close query", readonly: "Single read-only SELECT. Results are capped at 50,000 rows and 8 MiB. Use a database read-only account. Private hosts require server allowlisting.", failed: "Operation failed. Check permissions, source configuration, TLS, SQL and result limits.", retry: "Retry", prev: "Previous page", next: "Next page", records: "records", actions: "Actions",
};
const ZH: typeof EN = {
  managed: "系统管理", systemNotice: "仅展示 · 不可编辑",
  add: "新增 PostgreSQL 数据源", name: "数据源名称", host: "主机", port: "端口", database: "数据库", username: "用户名", password: "密码", keep: "留空保留已保存的密码。", enabled: "启用", type: "类型", template: "单据模板", system: "内置 PostgreSQL", edit: "编辑", remove: "删除", removeTitle: "删除该数据源？", removeHelp: "报表草稿或已发布版本引用的数据源不能删除。", save: "保存", cancel: "取消", test: "测试连接", connected: "连接成功", query: "查询", run: "运行查询", close: "关闭查询", readonly: "仅允许单条只读 SELECT。结果最多 50,000 行、8 MiB。请使用数据库只读账号，私网主机需在服务端加入白名单。", failed: "操作失败，请检查权限、来源配置、TLS、SQL 和结果限制。", retry: "重试", prev: "上一页", next: "下一页", records: "条记录", actions: "操作",
};
const TH: typeof EN = {
  managed: "จัดการโดยระบบ", systemNotice: "แสดงข้อมูลเท่านั้น · แก้ไขไม่ได้",
  add: "เพิ่มแหล่งข้อมูล PostgreSQL", name: "ชื่อแหล่งข้อมูล", host: "โฮสต์", port: "พอร์ต", database: "ฐานข้อมูล", username: "ชื่อผู้ใช้", password: "รหัสผ่าน", keep: "เว้นว่างเพื่อใช้รหัสผ่านที่บันทึกไว้", enabled: "เปิดใช้งาน", type: "ประเภท", template: "แม่แบบเอกสาร", system: "PostgreSQL ในระบบ", edit: "แก้ไข", remove: "ลบ", removeTitle: "ลบแหล่งข้อมูลนี้หรือไม่?", removeHelp: "ไม่สามารถลบแหล่งข้อมูลที่รายงานอ้างอิงอยู่", save: "บันทึก", cancel: "ยกเลิก", test: "ทดสอบการเชื่อมต่อ", connected: "เชื่อมต่อสำเร็จ", query: "เรียกค้น", run: "เรียกค้นข้อมูล", close: "ปิดการเรียกค้น", readonly: "ใช้ SELECT แบบอ่านอย่างเดียวหนึ่งคำสั่ง สูงสุด 50,000 แถวและ 8 MiB ใช้บัญชีฐานข้อมูลแบบอ่านอย่างเดียว โฮสต์ภายในต้องได้รับอนุญาตจากเซิร์ฟเวอร์", failed: "ดำเนินการไม่สำเร็จ ตรวจสอบสิทธิ์ การตั้งค่า TLS SQL และขีดจำกัดผลลัพธ์", retry: "ลองอีกครั้ง", prev: "หน้าก่อน", next: "หน้าถัดไป", records: "รายการ", actions: "การดำเนินการ",
};
const fresh = (): SourceInput => ({ name: "", host: "", port: 5432, database: "", username: "", password: "", ssl_mode: "verify-full", enabled: true });

export function DataSourceManager({ api, lang, allowCreate = true, canQuery = true, showSystemNotice = false }: { api: DataSourceApi; lang?: string; allowCreate?: boolean; canQuery?: boolean; showSystemNotice?: boolean }) {
  const l = lang === "zh" ? ZH : lang === "th" ? TH : EN;
  const [items, setItems] = useState<SourceMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id?: string; body: SourceInput } | null>(null);
  const [source, setSource] = useState<SourceMetadata | null>(null);
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<{ sql: string; table: TableResult } | null>(null);
  const request = useRef<AbortController | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const [removing, setRemoving] = useState<SourceMetadata | null>(null);
  useEffect(() => {
    const c = new AbortController(); lifetime.current = c;
    void api.list(c.signal).then(r => { if (!c.signal.aborted) setItems(r.items); }).catch(() => { if (!c.signal.aborted) setError(true); }).finally(() => { if (!c.signal.aborted) setLoading(false); });
    return () => { c.abort(); request.current?.abort(); };
  }, [api]);
  const reload = async () => {
    const signal = lifetime.current!.signal;
    const r = await api.list(signal); if (!signal.aborted) setItems(r.items);
  };
  const operate = async (job: () => Promise<unknown>) => {
    setBusy(true); setError(false); setNotice(false);
    try { await job(); } catch { if (!lifetime.current?.signal.aborted) setError(true); }
    finally { if (!lifetime.current?.signal.aborted) setBusy(false); }
  };
  const closeQuery = () => { request.current?.abort(); setSource(null); setResult(null); setSql(""); setBusy(false); setError(false); };
  const run = async (page: number) => {
    if (!source) return;
    request.current?.abort(); const c = new AbortController(); request.current = c;
    setBusy(true); setError(false); setResult(null);
    try { const table = await api.query(source.id, sql, page, c.signal); if (!c.signal.aborted) setResult({ sql, table }); }
    catch { if (!c.signal.aborted) setError(true); }
    finally { if (!c.signal.aborted) setBusy(false); }
  };
  const edit = (r?: SourceMetadata) => {
    setError(false); setNotice(false);
    setEditing({ id: r?.id, body: r ? { name: r.name, host: r.host!, port: r.port!, database: r.database!, username: r.username!, password: "", ssl_mode: "verify-full", enabled: r.enabled } : fresh() });
  };
  const body = editing?.body;
  const valid = body && [body.name, body.host, body.database, body.username].every(v => v.trim()) && (editing.id || body.password) && Number.isInteger(body.port) && body.port > 0 && body.port <= 65535;
  const table = result?.table;
  const rows: SourceRow[] = items.filter(source => source.kind !== "template");
  if (showSystemNotice) rows.unshift({ id: "system-notice", name: "SaiFlow PostgreSQL", kind: "system_notice" });
  return <Space direction="vertical" size="middle" style={{ width: "100%" }}>
    {allowCreate && <Button type="primary" disabled={busy} onClick={() => edit()}>{l.add}</Button>}
    {error && !editing && <Alert role="alert" type="error" message={l.failed} action={<Button onClick={() => void operate(reload)}>{l.retry}</Button>} />}
    {notice && <p role="status">{l.connected}</p>}
    <Table<SourceRow> rowKey="id" loading={loading} dataSource={rows} pagination={false} columns={[
      { key: "name", title: l.name, dataIndex: "name" },
      { key: "type", title: l.type, render: (_, r) => <Tag>{r.kind === "template" ? l.template : r.kind === "system_pg" || r.kind === "system_notice" ? l.system : "PostgreSQL"}</Tag> },
      { key: "host", title: l.host, render: (_, r) => r.kind !== "system_notice" && r.host ? `${r.host}:${r.port}` : "—" },
      { key: "enabled", title: l.enabled, render: (_, r) => r.kind === "system_notice" ? l.managed : <Checkbox checked={r.enabled} disabled /> },
      { key: "actions", title: l.actions, render: (_, r) => r.kind === "system_notice" ? <span>{l.systemNotice}</span> : r.kind === "template" ? null : <Space wrap>
        {r.kind === "postgresql" && <><Button disabled={busy} onClick={() => edit(r)}>{l.edit}</Button><Button danger disabled={busy} onClick={() => { setError(false); setRemoving(r); }}>{l.remove}</Button></>}
        <Button disabled={busy || !r.enabled} onClick={() => void operate(async () => { await api.test(r.id, lifetime.current!.signal); if (!lifetime.current?.signal.aborted) setNotice(true); })}>{l.test}</Button>
        {canQuery && <Button disabled={busy || !r.enabled} onClick={() => { closeQuery(); setSource(r); }}>{l.query}</Button>}
      </Space> },
    ]} />
    {source && <section aria-label={source.name}>
      <Space><strong>{source.name}</strong><Button onClick={closeQuery}>{l.close}</Button></Space>
      <Form.Item label="SQL" htmlFor="source-sql" help={l.readonly}><Input.TextArea id="source-sql" rows={6} maxLength={20000} value={sql} onChange={e => { request.current?.abort(); setSql(e.target.value); setResult(null); setBusy(false); }} /></Form.Item>
      <Button type="primary" disabled={!sql.trim()} loading={busy} onClick={() => void run(1)}>{l.run}</Button>
      {table && <><Table rowKey={(_, i) => String(i)} dataSource={table.rows} pagination={false} scroll={{ x: true }} columns={table.columns.map(c => ({ key: c.key, title: c.label, dataIndex: c.key, render: (v: string | null) => v ?? "—" }))} />
        <Space><Button aria-label={l.prev} disabled={busy || table.page <= 1} onClick={() => void run(table.page - 1)}>‹</Button><span aria-live="polite">{table.page} / {Math.max(1, Math.ceil(table.total / table.page_size))} · {table.total} {l.records}</span><Button aria-label={l.next} disabled={busy || table.page * table.page_size >= table.total} onClick={() => void run(table.page + 1)}>›</Button></Space>
      </>}
    </section>}
    <Modal open={!!removing} title={l.removeTitle} okText={l.remove} cancelText={l.cancel} okButtonProps={{ danger: true, loading: busy }} cancelButtonProps={{ disabled: busy }} closable={!busy} maskClosable={false} destroyOnHidden
      onCancel={() => { setRemoving(null); setError(false); }} onOk={() => void operate(async () => { if (!removing || lifetime.current?.signal.aborted) return; await api.remove(removing.id); if (lifetime.current?.signal.aborted) return; setRemoving(null); closeQuery(); await reload(); })}>
      <p>{l.removeHelp}</p>{error && <Alert role="alert" type="error" message={l.failed} />}
    </Modal>
    <Modal open={!!editing} title={editing?.id ? l.edit : l.add} okText={l.save} cancelText={l.cancel} okButtonProps={{ disabled: !valid, loading: busy }} cancelButtonProps={{ disabled: busy }} closable={!busy} maskClosable={false} destroyOnHidden
      onCancel={() => { setEditing(null); setError(false); }} onOk={() => void operate(async () => { if (!editing) return; await api.save(editing.body, editing.id); if (lifetime.current?.signal.aborted) return; setEditing(null); await reload(); })}>
      {body && <Form layout="vertical">
        {(["name", "host", "database", "username", "password"] as const).map(key => <Form.Item key={key} label={l[key]} htmlFor={`source-${key}`} required={key !== "password" || !editing?.id} help={key === "password" && editing?.id ? l.keep : undefined}>
          {key === "password" ? <Input.Password id={`source-${key}`} autoComplete="new-password" maxLength={1000} value={body[key]} disabled={busy} onChange={e => setEditing({ ...editing!, body: { ...body, [key]: e.target.value } })} /> : <Input id={`source-${key}`} maxLength={key === "host" ? 253 : key === "name" ? 100 : 63} value={body[key]} disabled={busy} onChange={e => setEditing({ ...editing!, body: { ...body, [key]: e.target.value } })} />}
        </Form.Item>)}
        <Form.Item label={l.port} htmlFor="source-port"><InputNumber id="source-port" min={1} max={65535} precision={0} value={body.port} disabled={busy} onChange={port => setEditing({ ...editing!, body: { ...body, port: port ?? 5432 } })} /></Form.Item>
        <p>TLS: verify-full</p><Checkbox checked={body.enabled} disabled={busy} onChange={e => setEditing({ ...editing!, body: { ...body, enabled: e.target.checked } })}>{l.enabled}</Checkbox>
      </Form>}
      {error && <Alert role="alert" type="error" message={l.failed} />}
    </Modal>
  </Space>;
}
