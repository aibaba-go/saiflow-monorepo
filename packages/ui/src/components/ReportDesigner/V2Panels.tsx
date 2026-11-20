import { Alert, Button, Checkbox, Form, Input, InputNumber, Select, Space, Switch } from "antd";
import { useEffect, useRef, useState } from "react";
import { REPORT_PALETTES, type FilterGroup, type FilterRule, type ReportCard, type ReportConfig } from "../reportTypes";
import type { DesignerField, DesignerFields } from "./model";

const EN = { filters: "Filters", pageFilters: "Page filters", add: "Add condition", remove: "Remove condition", field: "Field", operator: "Operator", value: "Value", all: "Match all (AND)", any: "Match any (OR)", targets: "Apply to cards (explicit field mapping)", load: "Loading fields…", failed: "Could not load fields", retry: "Retry", theme: "Theme", brand: "Brand", ocean: "Ocean", sunset: "Sunset", forest: "Forest", background: "Page background", radius: "Corner radius", gap: "Card spacing", shadow: "Card shadow", surface: "Card surface", white: "White", tinted: "Tinted", direction: "Bar direction", vertical: "Vertical", horizontal: "Horizontal", fill: "Line area fill", content: "Content", image: "Image", upload: "Upload JPEG / PNG (5 MiB)", alt: "Image description", fit: "Image fit", contain: "Contain", cover: "Cover", mode: "Content mode", html: "HTML", url: "Embedded HTTPS page", safe: "Scripts, external resources and forms are disabled. Embedded pages must use a server-approved HTTPS origin.", eq: "Equals", neq: "Not equal", in: "In list", not_in: "Not in list", empty: "Is empty", not_empty: "Is not empty", contains: "Contains", gt: "Greater than", gte: "At least", lt: "Less than", lte: "At most", between: "Between", list: "One value per line", from: "From", to: "To" };
const ZH: typeof EN = { filters: "筛选", pageFilters: "页面筛选", add: "增加条件", remove: "移除条件", field: "字段", operator: "运算符", value: "值", all: "满足全部（AND）", any: "满足任一（OR）", targets: "应用到卡片（显式字段映射）", load: "加载字段中…", failed: "字段加载失败", retry: "重试", theme: "主题", brand: "品牌", ocean: "海洋", sunset: "日落", forest: "森林", background: "页面背景", radius: "圆角", gap: "卡片间距", shadow: "卡片阴影", surface: "卡片背景", white: "白色", tinted: "浅彩色", direction: "条形方向", vertical: "纵向", horizontal: "横向", fill: "折线区域填充", content: "内容", image: "图片", upload: "上传 JPEG / PNG（5 MiB）", alt: "图片描述", fit: "图片适配", contain: "完整显示", cover: "裁剪铺满", mode: "内容模式", html: "HTML", url: "内嵌 HTTPS 页面", safe: "禁用脚本、外部资源与表单。内嵌页面必须使用服务端允许的 HTTPS 来源。", eq: "等于", neq: "不等于", in: "包含于列表", not_in: "不包含于列表", empty: "为空", not_empty: "不为空", contains: "包含文本", gt: "大于", gte: "大于等于", lt: "小于", lte: "小于等于", between: "区间", list: "每行一个值", from: "起始值", to: "结束值" };
const TH: typeof EN = { filters: "ตัวกรอง", pageFilters: "ตัวกรองหน้า", add: "เพิ่มเงื่อนไข", remove: "ลบเงื่อนไข", field: "ฟิลด์", operator: "ตัวดำเนินการ", value: "ค่า", all: "ตรงทั้งหมด (AND)", any: "ตรงอย่างใดอย่างหนึ่ง (OR)", targets: "ใช้กับการ์ด (จับคู่ฟิลด์โดยชัดเจน)", load: "กำลังโหลดฟิลด์…", failed: "โหลดฟิลด์ไม่ได้", retry: "ลองใหม่", theme: "ธีม", brand: "แบรนด์", ocean: "มหาสมุทร", sunset: "พระอาทิตย์ตก", forest: "ป่า", background: "พื้นหลังหน้า", radius: "มุมโค้ง", gap: "ระยะห่างการ์ด", shadow: "เงาการ์ด", surface: "พื้นหลังการ์ด", white: "ขาว", tinted: "สีอ่อน", direction: "ทิศทางแท่ง", vertical: "แนวตั้ง", horizontal: "แนวนอน", fill: "พื้นที่ใต้เส้น", content: "เนื้อหา", image: "รูปภาพ", upload: "อัปโหลด JPEG / PNG (5 MiB)", alt: "คำอธิบายรูปภาพ", fit: "การปรับรูปภาพ", contain: "แสดงทั้งหมด", cover: "เต็มพื้นที่", mode: "โหมดเนื้อหา", html: "HTML", url: "หน้า HTTPS ฝังตัว", safe: "ปิดสคริปต์ ทรัพยากรภายนอก และฟอร์ม หน้าฝังตัวต้องมาจาก HTTPS ที่เซิร์ฟเวอร์อนุญาต", eq: "เท่ากับ", neq: "ไม่เท่ากับ", in: "อยู่ในรายการ", not_in: "ไม่อยู่ในรายการ", empty: "ว่าง", not_empty: "ไม่ว่าง", contains: "มีข้อความ", gt: "มากกว่า", gte: "อย่างน้อย", lt: "น้อยกว่า", lte: "ไม่เกิน", between: "ระหว่าง", list: "หนึ่งค่าต่อบรรทัด", from: "จาก", to: "ถึง" };
export const v2Labels = (lang?: string) => lang === "zh" ? ZH : lang === "th" ? TH : EN;

export function filterFields(fields: readonly DesignerField[], card: ReportCard) {
  return fields.filter((f) => f.compatible && ["string", "integer", "decimal", "amount", "date"].includes(f.type) && (f.grain === "document" || (card.data?.grain === "table" && f.table_key === card.data.table_key)));
}

export function FiltersEditor({ group, fields, onChange, lang, readOnly }: { group?: FilterGroup | null; fields: readonly DesignerField[]; onChange(g: FilterGroup | null): void; lang?: string; readOnly?: boolean }) {
  const l = v2Labels(lang);
  const value = group ?? { match: "and", rules: [] };
  const change = (i: number, rule: FilterRule) => onChange({ ...value, rules: value.rules.map((r, j) => j === i ? rule : r) });
  return <div className="sf-rd-filters">
    <Select aria-label={l.filters} value={value.match} disabled={readOnly} options={[{ value: "and", label: l.all }, { value: "or", label: l.any }]} onChange={(match) => onChange({ ...value, match })} style={{ width: "100%" }} />
    {value.rules.map((rule, i) => {
      const type = fields.find((f) => f.path === rule.path)?.type;
      const ops: FilterRule["op"][] = ["eq", "neq", "in", "not_in", "empty", "not_empty", ...(type === "string" ? ["contains" as const] : ["gt", "gte", "lt", "lte", "between"] as const)];
      const arr = Array.isArray(rule.value) ? rule.value : [];
      return <div key={i} className="sf-rd-filter-rule">
        <Select aria-label={`${l.field} ${i + 1}`} value={rule.path || undefined} placeholder={l.field} disabled={readOnly} virtual={false} options={fields.map((f) => ({ value: f.path, label: `${f.name} · ${f.path}` }))} onChange={(path) => change(i, { path, op: "eq", value: "" })} style={{ width: "100%" }} />
        <Select aria-label={`${l.operator} ${i + 1}`} value={rule.op} disabled={readOnly} options={ops.map((op) => ({ value: op, label: l[op] }))} onChange={(op) => change(i, { ...rule, op, value: op === "between" ? ["", ""] : op === "in" || op === "not_in" ? [] : "" })} style={{ width: "100%" }} />
        {rule.op === "between" ? <Space><Input aria-label={`${l.from} ${i + 1}`} disabled={readOnly} type={type === "date" ? "date" : "text"} maxLength={200} value={arr[0] ?? ""} onChange={(e) => change(i, { ...rule, value: [e.target.value, arr[1] ?? ""] })} /><Input aria-label={`${l.to} ${i + 1}`} disabled={readOnly} type={type === "date" ? "date" : "text"} maxLength={200} value={arr[1] ?? ""} onChange={(e) => change(i, { ...rule, value: [arr[0] ?? "", e.target.value] })} /></Space> : rule.op === "in" || rule.op === "not_in" ? <Input.TextArea aria-label={`${l.value} ${i + 1}`} disabled={readOnly} placeholder={l.list} value={arr.join("\n")} onChange={(e) => change(i, { ...rule, value: e.target.value.split("\n").slice(0, 100) })} /> : !["empty", "not_empty"].includes(rule.op) ? <Input aria-label={`${l.value} ${i + 1}`} disabled={readOnly} maxLength={200} type={type === "date" ? "date" : "text"} value={typeof rule.value === "string" ? rule.value : ""} onChange={(e) => change(i, { ...rule, value: e.target.value })} /> : null}
        <Button size="small" danger disabled={readOnly} onClick={() => onChange(value.rules.length === 1 ? null : { ...value, rules: value.rules.filter((_, j) => j !== i) })}>{l.remove}</Button>
      </div>;
    })}
    <Button disabled={readOnly || value.rules.length >= 20 || !fields.length} onClick={() => onChange({ ...value, rules: [...value.rules, { path: "", op: "eq", value: "" }] })}>{l.add}</Button>
  </div>;
}

export function ContentPanel({ card, onCard, onUpload, lang, readOnly }: { card: ReportCard; onCard(c: ReportCard): void; onUpload?: (file: File, signal: AbortSignal) => Promise<string>; lang?: string; readOnly?: boolean }) {
  const l = v2Labels(lang);
  const content = card.content ?? {};
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const latest = useRef({ card, onCard });
  useEffect(() => { latest.current = { card, onCard }; }, [card, onCard]);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const patch = (next: typeof content) => onCard({ ...card, content: { ...content, ...next } });
  return <div>
    {card.type === "image" ? <>
      <Form.Item label={l.image}><input type="file" aria-label={l.upload} accept="image/jpeg,image/png" disabled={readOnly || busy || !onUpload} onChange={async (e) => {
        const file = e.target.files?.[0]; if (!file || !onUpload) return;
        e.target.value = "";
        setError(false);
        if (file.size > 5 * 1024 * 1024) { setError(true); return; }
        controller.current?.abort(); const c = new AbortController(); controller.current = c;
        setBusy(true);
        try { const id = await onUpload(file, c.signal); if (!c.signal.aborted) { const now = latest.current; now.onCard({ ...now.card, content: { ...now.card.content, asset_id: id } }); } }
        catch { if (!c.signal.aborted) setError(true); }
        finally { if (!c.signal.aborted) setBusy(false); }
      }} /></Form.Item>
      {error && <Alert type="error" message={l.failed} />}
      <Form.Item label={l.alt}><Input aria-label={l.alt} value={content.alt ?? ""} maxLength={200} disabled={readOnly} onChange={(e) => patch({ alt: e.target.value })} /></Form.Item>
      <Form.Item label={l.fit}><Select aria-label={l.fit} disabled={readOnly} value={content.fit ?? "contain"} options={[{ value: "contain", label: l.contain }, { value: "cover", label: l.cover }]} onChange={(fit) => patch({ fit })} /></Form.Item>
    </> : <>
      <Form.Item label={l.mode}><Select aria-label={l.mode} value={content.mode ?? "html"} disabled={readOnly} options={[{ value: "html", label: l.html }, { value: "url", label: l.url }]} onChange={(mode) => patch({ mode })} /></Form.Item>
      <Form.Item label={content.mode === "url" ? l.url : l.html}>{content.mode === "url" ? <Input aria-label={l.url} maxLength={2000} disabled={readOnly} value={content.url ?? ""} onChange={(e) => patch({ url: e.target.value })} /> : <Input.TextArea aria-label={l.html} maxLength={20000} rows={10} disabled={readOnly} value={content.html ?? ""} onChange={(e) => patch({ html: e.target.value })} />}</Form.Item>
      <Alert type="info" message={l.safe} />
    </>}
  </div>;
}

export function CardAppearance({ card, onCard, lang, readOnly }: { card: ReportCard; onCard(c: ReportCard): void; lang?: string; readOnly?: boolean }) {
  const l = v2Labels(lang), style = card.style ?? {};
  return <>
    <Form.Item label={l.surface}><Select aria-label={l.surface} value={style.surface ?? "white"} disabled={readOnly} options={[{ value: "white", label: l.white }, { value: "tinted", label: l.tinted }]} onChange={(surface) => onCard({ ...card, style: { ...style, surface } })} /></Form.Item>
    {card.type === "bar" && <Form.Item label={l.direction}><Select aria-label={l.direction} value={style.direction ?? "vertical"} disabled={readOnly} options={[{ value: "vertical", label: l.vertical }, { value: "horizontal", label: l.horizontal }]} onChange={(direction) => onCard({ ...card, style: { ...style, direction } })} /></Form.Item>}
    {card.type === "line" && <Form.Item label={l.fill}><Switch aria-label={l.fill} checked={style.fill ?? true} disabled={readOnly} onChange={(fill) => onCard({ ...card, style: { ...style, fill } })} /></Form.Item>}
  </>;
}

export function PageAppearance({ value, onChange, lang, readOnly }: { value: ReportConfig; onChange(c: ReportConfig): void; lang?: string; readOnly?: boolean }) {
  const l = v2Labels(lang), a = value.appearance ?? {};
  const patch = (v: typeof a) => onChange({ ...value, appearance: { ...a, ...v } });
  return <>
    <Form.Item label={l.theme}><div className="sf-rd-themes">{(Object.keys(REPORT_PALETTES) as (keyof typeof REPORT_PALETTES)[]).map((theme) => <Button key={theme} disabled={readOnly} aria-pressed={(a.theme ?? "brand") === theme} onClick={() => patch({ theme })}>{l[theme]}<span className="sf-rd-swatches">{REPORT_PALETTES[theme].slice(0, 4).map((color) => <i key={color} style={{ background: color }} />)}</span></Button>)}</div></Form.Item>
    <Form.Item label={l.background}><input aria-label={l.background} type="color" disabled={readOnly} value={a.background ?? "#F4F7FB"} onChange={(e) => patch({ background: e.target.value })} /></Form.Item>
    <Form.Item label={l.radius}><InputNumber aria-label={l.radius} min={0} max={24} precision={0} disabled={readOnly} value={a.radius ?? 12} onChange={(radius) => patch({ radius: radius ?? 12 })} /></Form.Item>
    <Form.Item label={l.gap}><InputNumber aria-label={l.gap} min={8} max={32} precision={0} disabled={readOnly} value={a.gap ?? 16} onChange={(gap) => patch({ gap: gap ?? 16 })} /></Form.Item>
    <Form.Item label={l.shadow}><Switch aria-label={l.shadow} checked={a.shadow ?? false} disabled={readOnly} onChange={(shadow) => patch({ shadow })} /></Form.Item>
  </>;
}

type PageFiltersProps = { value: ReportConfig; onChange(c: ReportConfig): void; loadFields(tid: number, vids: number[]): Promise<DesignerFields>; lang?: string; readOnly?: boolean };
export function PageFilters(props: PageFiltersProps) {
  const [open, setOpen] = useState(false);
  return open || props.value.filters?.rules.length ? <ActivePageFilters {...props} /> : <Button style={{ marginBottom: 16 }} disabled={props.readOnly} onClick={() => setOpen(true)}>{v2Labels(props.lang).pageFilters}</Button>;
}

function ActivePageFilters({ value, onChange, loadFields, lang, readOnly }: PageFiltersProps) {
  const l = v2Labels(lang);
  const dataCards = value.cards.filter((c) => c.data?.template_id && c.data.template_version_ids?.length && c.type !== "image" && c.type !== "html");
  const key = JSON.stringify(dataCards.map((c) => [c.id, c.data!.template_id, c.data!.template_version_ids]));
  const [loaded, setLoaded] = useState<{ key: string; loader: PageFiltersProps["loadFields"]; attempt: number; catalog: Record<string, DesignerField[]>; error: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const current = loaded?.key === key && loaded.loader === loadFields && loaded.attempt === attempt ? loaded : null;
  const catalog = current?.catalog ?? {};
  const state = current ? current.error ? "error" : "ok" : "loading";
  useEffect(() => {
    let active = true;
    const bindings = JSON.parse(key) as [string, number, number[]][];
    Promise.all(bindings.map(async ([id, tid, vids]) => [id, (await loadFields(tid, vids)).fields] as const)).then((items) => { if (active) setLoaded({ key, loader: loadFields, attempt, catalog: Object.fromEntries(items), error: false }); }).catch(() => { if (active) setLoaded({ key, loader: loadFields, attempt, catalog: {}, error: true }); });
    return () => { active = false; };
  }, [key, loadFields, attempt]);
  const source = dataCards.find((c) => value.filters?.targets[c.id]) ?? dataCards[0];
  const fields = source ? filterFields(catalog[source.id] ?? [], source) : [];
  const targets = value.filters?.targets ?? {};
  return <section aria-label={l.pageFilters}>
    <h4>{l.pageFilters}</h4>
    {state === "loading" ? <p>{l.load}</p> : state === "error" ? <Alert type="error" message={l.failed} action={<Button onClick={() => setAttempt(attempt + 1)}>{l.retry}</Button>} /> : <FiltersEditor group={value.filters} fields={fields} lang={lang} readOnly={readOnly} onChange={(group) => {
      if (!group || !source) { onChange({ ...value, filters: null }); return; }
      const next: Record<string, Record<string, string>> = {};
      for (const id of new Set([...Object.keys(targets), source.id])) next[id] = Object.fromEntries(group.rules.map((r) => [r.path, targets[id]?.[r.path] ?? (id === source.id ? r.path : "")]));
      onChange({ ...value, filters: { ...group, targets: next } });
    }} />}
    {!!value.filters?.rules.length && <><p>{l.targets}</p>{dataCards.map((c) => <div key={c.id} className="sf-rd-filter-rule">
      <Checkbox disabled={readOnly || c.id === source?.id} checked={!!targets[c.id]} onChange={(e) => { const next = { ...targets }; if (e.target.checked) next[c.id] = {}; else delete next[c.id]; onChange({ ...value, filters: { ...value.filters!, targets: next } }); }}>{c.title || c.id}</Checkbox>
      {targets[c.id] && value.filters!.rules.map((rule, i) => <Select key={i} aria-label={`${c.title || c.id} · ${rule.path}`} disabled={readOnly} value={targets[c.id]?.[rule.path] || undefined} placeholder={l.field} virtual={false} options={filterFields(catalog[c.id] ?? [], c).map((f) => ({ value: f.path, label: `${f.name} · ${f.path}` }))} onChange={(path) => onChange({ ...value, filters: { ...value.filters!, targets: { ...targets, [c.id]: { ...targets[c.id], [rule.path]: path } } } })} style={{ width: "100%" }} />)}
    </div>)}</>}
  </section>;
}
