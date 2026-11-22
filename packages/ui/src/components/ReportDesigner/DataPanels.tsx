import { Alert, Button, Form, Input, InputNumber, Select } from "antd";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReportCard, SourceRelation, TableResult } from "../reportTypes";
import { localName, type DesignerField } from "./model";

const EN = { fields: "Display fields", pageSize: "Rows per page", label: "Column label", help: "Raw records, without aggregation. Select up to 50 columns in display order." };
const ZH: typeof EN = { fields: "显示字段", pageSize: "每页条数", label: "列标题", help: "显示原始记录，不聚合。按显示顺序选择最多 50 个字段。" };
const TH: typeof EN = { fields: "ฟิลด์ที่แสดง", pageSize: "แถวต่อหน้า", label: "ชื่อคอลัมน์", help: "แสดงรายการต้นฉบับโดยไม่รวมยอด เลือกได้ไม่เกิน 50 ฟิลด์ตามลำดับ" };

const SQL_EN = { source: "Data source", template: "Document template", relational: "Relational database", noDatabases: "No enabled PostgreSQL sources. Add a connection in Data sources; document templates remain available.", mode: "Query mode", table: "Select table", manual: "Write SQL", relation: "Table or view", retry: "Reload tables", catalogError: "Tables could not be loaded. Check source permissions and connection.", run: "Run and discover fields", help: "A single read-only SELECT. Rediscover fields after changing the SQL. Live SQL requires organization-wide data access.", failed: "The query failed. Check source access, SQL, TLS and result limits.", discovered: "Result fields discovered" };
const SQL_ZH: typeof SQL_EN = { source: "数据源", template: "单据模板", relational: "关系型数据库", noDatabases: "暂无已启用的 PostgreSQL 数据源，请在数据源管理中新增连接；仍可选择单据模板。", mode: "查询方式", table: "选择表", manual: "编写 SQL", relation: "表或视图", retry: "重新加载表", catalogError: "无法加载表，请检查来源权限和连接。", run: "运行并发现字段", help: "仅允许单条只读 SELECT。修改 SQL 后请重新发现字段。查询需要组织全量数据权限。", failed: "查询失败，请检查来源权限、SQL、TLS 和结果限制。", discovered: "已发现结果字段" };
const SQL_TH: typeof SQL_EN = { source: "แหล่งข้อมูล", template: "แม่แบบเอกสาร", relational: "ฐานข้อมูลเชิงสัมพันธ์", noDatabases: "ไม่มีแหล่งข้อมูล PostgreSQL ที่เปิดใช้งาน เพิ่มการเชื่อมต่อในแหล่งข้อมูล หรือเลือกแม่แบบเอกสารได้", mode: "วิธีเรียกค้น", table: "เลือกตาราง", manual: "เขียน SQL", relation: "ตารางหรือวิว", retry: "โหลดตารางใหม่", catalogError: "โหลดตารางไม่ได้ ตรวจสอบสิทธิ์และการเชื่อมต่อ", run: "เรียกค้นและค้นหาฟิลด์", help: "ใช้ SELECT แบบอ่านอย่างเดียวหนึ่งคำสั่ง ค้นหาฟิลด์ใหม่เมื่อ SQL เปลี่ยน ต้องมีสิทธิ์อ่านข้อมูลทั้งองค์กร", failed: "เรียกค้นไม่สำเร็จ ตรวจสอบสิทธิ์ SQL TLS และขีดจำกัดผลลัพธ์", discovered: "ค้นพบฟิลด์แล้ว" };
export const sqlLabels = (lang?: string) => lang === "zh" ? SQL_ZH : lang === "th" ? SQL_TH : SQL_EN;
export type SourceQuery = (sourceId: string, sql: string, signal: AbortSignal) => Promise<TableResult>;

export type SourceTables = (sourceId: string, signal: AbortSignal) => Promise<SourceRelation[]>;

export function SqlBinding({ card, onCard, querySource, loadTables, lang, readOnly }: { card: ReportCard; onCard(card: ReportCard): void; querySource?: SourceQuery; loadTables?: SourceTables; lang?: string; readOnly?: boolean }) {
  const l = sqlLabels(lang);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const latest = useRef({ card, onCard });
  useLayoutEffect(() => { latest.current = { card, onCard }; }, [card, onCard]);
  const mode = card.data?.query_mode ?? "sql";
  const sourceId = card.data?.source_id;
  const [catalogResult, setCatalog] = useState<{ key: string; items: SourceRelation[]; busy: boolean; error: boolean }>({ key: "", items: [], busy: false, error: false });
  const [reload, setReload] = useState(0);
  const catalogKey = `${sourceId}:${reload}`;
  const catalog = catalogResult.key === catalogKey ? catalogResult : { items: [], busy: true, error: false };
  useEffect(() => () => controller.current?.abort(), [card.id, sourceId, card.data?.sql, mode]);
  useEffect(() => {
    if (mode !== "table" || !loadTables || !sourceId) return;
    const c = new AbortController();
    loadTables(sourceId, c.signal).then(
      items => { if (!c.signal.aborted) setCatalog({ key: catalogKey, items, busy: false, error: false }); },
      () => { if (!c.signal.aborted) setCatalog({ key: catalogKey, items: [], busy: false, error: true }); },
    );
    return () => c.abort();
  }, [mode, sourceId, loadTables, catalogKey]);
  const updateBinding = (patch: Partial<NonNullable<ReportCard["data"]>>) => {
    controller.current?.abort(); setBusy(false); setError(false);
    const data = { ...card.data, ...patch, result_fields: [], display_fields: [] };
    delete data.measure; delete data.dimension; delete data.series; delete data.date_field;
    delete data.unit; delete data.filters; delete data.confirmed_paths;
    onCard({ ...card, data });
  };
  return <>
    <Form.Item label={l.mode}>
      <Select aria-label={l.mode} virtual={false} disabled={readOnly} value={mode} options={[{ value: "table", label: l.table }, { value: "sql", label: l.manual }]} onChange={(value: "table" | "sql") => updateBinding({ query_mode: value, relation: null, sql: value === "sql" ? card.data?.sql ?? "" : "" })} />
    </Form.Item>
    {mode === "table" && <>
      <Form.Item label={l.relation}>
        <Select aria-label={l.relation} virtual={false} showSearch optionFilterProp="label" loading={catalog.busy} disabled={readOnly || !loadTables || !sourceId} value={card.data?.relation ? JSON.stringify([card.data.relation.schema, card.data.relation.name]) : undefined} options={catalog.items.map(r => ({ value: JSON.stringify([r.schema, r.name]), label: `${r.schema}.${r.name} · ${r.kind}` }))} onChange={(key: string) => {
          const relation = catalog.items.find(r => JSON.stringify([r.schema, r.name]) === key);
          if (!relation) return;
          const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
          updateBinding({ query_mode: "table", relation: { schema: relation.schema, name: relation.name }, sql: `SELECT * FROM ${quote(relation.schema)}.${quote(relation.name)}` });
        }} />
      </Form.Item>
      {catalog.error && <Alert type="error" message={l.catalogError} />}
      <Button disabled={readOnly || !loadTables || !sourceId} onClick={() => setReload(n => n + 1)}>{l.retry}</Button>
    </>}
    <Form.Item label="SQL" help={l.help}>
      <Input.TextArea aria-label="SQL" rows={6} maxLength={20000} value={card.data?.sql ?? ""} disabled={readOnly} readOnly={mode === "table"}
        onChange={(e) => updateBinding({ sql: e.target.value })} />
    </Form.Item>
    <Button loading={busy} disabled={readOnly || !querySource || !sourceId || !card.data?.sql?.trim()} onClick={async () => {
      const sourceId = card.data?.source_id, sql = card.data?.sql;
      if (!querySource || !sourceId || !sql) return;
      controller.current?.abort(); const c = new AbortController(); controller.current = c;
      setBusy(true); setError(false);
      try {
        const result = await querySource(sourceId, sql, c.signal);
        const now = latest.current, data = now.card.data;
        if (!c.signal.aborted && data?.source_id === sourceId && data.sql === sql) now.onCard({ ...now.card, data: { ...data, result_fields: result.columns, display_fields: data.display_fields?.length ? data.display_fields : result.columns.slice(0, 50).map((f) => ({ path: f.key, label: f.label })) } });
      } catch { if (!c.signal.aborted) setError(true); }
      finally { if (!c.signal.aborted) setBusy(false); }
    }}>{l.run}</Button>
    {error && <Alert type="error" message={l.failed} />}
    {!!card.data?.result_fields?.length && <p role="status">{l.discovered}: {card.data.result_fields.length}</p>}
  </>;
}

export function RawFields({ card, fields, onCard, typeLabel, lang, readOnly }: { card: ReportCard; fields: readonly DesignerField[]; onCard(card: ReportCard): void; typeLabel(type: string): string; lang?: string; readOnly?: boolean }) {
  const l = lang === "zh" ? ZH : lang === "th" ? TH : EN;
  const available = fields.filter((f) => f.compatible && (f.grain === "document" || (card.data?.grain === "table" && f.table_key === card.data.table_key)));
  const selected = card.data?.display_fields ?? available.map((f) => ({ path: f.path, label: localName(f, lang) }));
  return <fieldset className="sf-rd-group">
    <legend>{l.fields}</legend>
    <Form.Item label={l.fields} help={l.help}>
      <Select mode="multiple" aria-label={l.fields} virtual={false} disabled={readOnly} value={selected.map((f) => f.path)} maxCount={50}
        options={available.map((f) => ({ value: f.path, label: `${localName(f, lang)} · ${typeLabel(f.type)}` }))}
        onChange={(paths: string[]) => onCard({ ...card, data: { ...card.data, display_fields: paths.map((path) => selected.find((f) => f.path === path) ?? { path, label: localName(available.find((f) => f.path === path)!, lang) }) } })} style={{ width: "100%" }} />
    </Form.Item>
    {selected.map((f, i) => <Form.Item key={f.path} label={`${l.label} · ${f.path}`}>
      <Input aria-label={`${l.label} ${i + 1}`} maxLength={100} disabled={readOnly} value={f.label} onChange={(e) => onCard({ ...card, data: { ...card.data, display_fields: selected.map((field, index) => index === i ? { ...field, label: e.target.value } : field) } })} />
    </Form.Item>)}
    <Form.Item label={l.pageSize}><InputNumber aria-label={l.pageSize} min={5} max={100} precision={0} disabled={readOnly} value={card.data?.page_size ?? 20} onChange={(value) => onCard({ ...card, data: { ...card.data, page_size: value ?? 20 } })} /></Form.Item>
  </fieldset>;
}
