/**
 * structured OCR JSON 的表格化视图与按路径编辑。
 * TextIn Prompt 模式返回任意嵌套的 key-value + 对象数组；这里统一折算成
 * 「字段表 + 数据表」，并保留每个值在原始 JSON 中的路径，供核验页就地修改。
 */

import type { TemplateSchema, TemplateFieldType } from './api';

export type Path = (string | number)[];
export type JsonRecord = Record<string, unknown>;

/** FR-VERIFY-015 / document-template-mapping D14: generic rows omit this metadata. */
export interface FieldMetadata {
  name?: string;
  templateOwned?: boolean;
  required?: boolean;
  type?: TemplateFieldType;
}

export interface FieldRow extends FieldMetadata {
  path: Path;
  key: string;
  value: unknown;
  editable: boolean;
}

export interface FieldSection extends FieldMetadata {
  path: string;
  /** 原始 JSON 路径（保留数组下标类型），用于增删字段 */
  parts: Path;
  rows: FieldRow[];
}

export interface TableCell extends FieldMetadata {
  path: Path;
  value: unknown;
  editable: boolean;
}

export interface TableRow {
  path: Path;
  cells: TableCell[];
}

export type TableKind = 'records' | 'matrix';

export interface TableSection extends FieldMetadata {
  path: string;
  /** 原始 JSON 路径（保留数组下标类型），用于增删行 */
  parts: Path;
  /** records = 对象数组（按列名取值）；matrix = 二维数组（按列序号取值） */
  kind: TableKind;
  columns: string[];
  columnMetadata?: FieldMetadata[];
  rows: TableRow[];
}

export type StructuredSection =
  | { kind: 'fields'; section: FieldSection }
  | { kind: 'table'; section: TableSection };

export interface StructuredGroup {
  key: string;
  name?: string;
  sections: StructuredSection[];
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isScalar(value: unknown): boolean {
  return value === null || typeof value !== 'object';
}

function isDisplayableLeaf(value: unknown): boolean {
  return isScalar(value) || (Array.isArray(value) && value.every(isScalar));
}

export function displayName(value: string): string {
  return value
    .split('.')
    .map((part) => part.replace(/_/g, ' '))
    .join(' / ');
}

// ---------- 金额显示 ----------
// 单据中的数字默认视为金额：千分位逗号 + 至少保留 2 位小数（29650 → 29,650.00，68523.4 → 68,523.40），
// 超过 2 位的原样保留不截断；序号、数量、编号、比率等计数/标识字段按原值显示。
// 规则与后端导出 routes/exports.py 的 _format_number 保持一致。

// 优先级：计数/比率（数量、序号、税率…）> 金额（金额、单价、合计…）> 编号类（no、item…）> 默认金额
const COUNT_TOKENS = new Set([
  'seq', 'sequence', 'qty', 'quantity', 'count', 'pcs', 'piece', 'pieces', 'page', 'pages', 'id',
  'tel', 'phone', 'fax', 'mobile', 'year', 'zip', 'postal', 'postcode', 'rate', 'ratio', 'percent',
  'pct',
]);
const AMOUNT_TOKENS = new Set([
  'amount', 'amt', 'price', 'total', 'subtotal', 'sum', 'vat', 'tax', 'discount', 'fee', 'cost',
  'balance', 'paid', 'payment', 'deposit', 'charge', 'money', 'net', 'gross',
]);
const LABEL_TOKENS = new Set(['no', 'num', 'number', 'index', 'idx', 'line', 'row', 'item', 'code']);
const COUNT_TEXT = /序号|数量|页|率|ลำดับ|หน้า|อัตรา/;
const AMOUNT_TEXT = /金额|价|费|税|额|เงิน|ราคา|ภาษี|ส่วนลด|ยอด/;
const LABEL_TEXT = /编号|เลขที่|จำนวน/;

function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

/** 该字段的数字是否按金额显示（默认是；明确的计数/标识字段除外） */
export function isAmountKey(key = ''): boolean {
  const tokens = keyTokens(key);
  if (tokens.some((tk) => COUNT_TOKENS.has(tk)) || COUNT_TEXT.test(key)) return false;
  if (tokens.some((tk) => AMOUNT_TOKENS.has(tk)) || AMOUNT_TEXT.test(key)) return true;
  return !(tokens.some((tk) => LABEL_TOKENS.has(tk)) || LABEL_TEXT.test(key));
}

export function formatNumber(value: number, key = ''): string {
  const text = String(value);
  if (!Number.isFinite(value) || !isAmountKey(key) || /e/i.test(text)) return text;
  const sign = text.startsWith('-') ? '-' : '';
  const [int, frac = ''] = text.slice(sign.length).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}.${frac.padEnd(2, '0')}`;
}

/** Format decimal strings without Number(), rounding or truncating their precision. */
export function formatAmount(value: string | number): string {
  const text = String(value);
  if (!/^-?\d+(\.\d+)?$/.test(text)) return text;
  const sign = text.startsWith('-') ? '-' : '';
  const [int, frac = ''] = text.slice(sign.length).split('.');
  return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac.padEnd(2, '0')}`;
}

function scalarText(value: unknown, key: string, empty: string, type?: TemplateFieldType): string {
  if (value === null || value === undefined) return empty;
  if (type !== undefined) {
    return type === 'amount' && (typeof value === 'string' || typeof value === 'number')
      ? formatAmount(value)
      : String(value);
  }
  if (typeof value === 'number') return formatNumber(value, key);
  return String(value);
}

export function formatCell(value: unknown, key = '', type?: TemplateFieldType): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    if (value.every((item) => isScalar(item))) {
      return value.map((item) => scalarText(item, key, '—', type)).join('\n');
    }
  }
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return scalarText(value, key, '—', type);
}

export function inputText(value: unknown, key = '', type?: TemplateFieldType): string {
  return scalarText(value, key, '', type);
}

export function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/** Backend validation paths use brackets for array indices. */
export function pathText(path: Path): string {
  return path.reduce<string>((text, part) =>
    typeof part === 'number' ? `${text}[${part}]` : `${text}${text ? '.' : ''}${part}`, '');
}

export function templateTypeAtPath(
  schema: TemplateSchema | null | undefined,
  path: Path,
): TemplateFieldType | undefined {
  const group = schema?.groups.find((candidate) => candidate.key === path[0]);
  const item = group?.items.find((candidate) => candidate.key === path[1]);
  if (item?.kind === 'field' && path.length === 2) return item.type;
  if (item?.kind === 'table' && path.length === 4 && typeof path[2] === 'number') {
    return item.columns.find((column) => column.key === path[3])?.type;
  }
  return undefined;
}

/** Required columns apply only to existing rows; empty tables never block confirmation. */
export function requiredMissing(schema: TemplateSchema | null | undefined, data: unknown): string[] {
  const missing: string[] = [];
  for (const group of schema?.groups ?? []) {
    for (const item of group.items) {
      const path: Path = [group.key, item.key];
      const value = getAtPath(data, path);
      if (item.kind === 'field') {
        if (item.required && isEmptyValue(value)) missing.push(pathText(path));
      } else if (Array.isArray(value)) {
        value.forEach((row, index) => {
          for (const column of item.columns) {
            if (column.required && isEmptyValue(getAtPath(row, [column.key]))) {
              missing.push(pathText([...path, index, column.key]));
            }
          }
        });
      }
    }
  }
  return missing;
}

/** 输入框中的数字文本（允许千分位逗号） */
export function parseNumberText(text: string): number | null {
  const s = text.trim().replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

export function getAtPath(root: unknown, path: Path): unknown {
  let node = root;
  for (const part of path) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string | number, unknown>)[part];
  }
  return node;
}

/** 修改 draft 中 path 指向的标量；draft 为 reactive 对象时视图会自动更新 */
export function setAtPath(root: unknown, path: Path, value: unknown): void {
  if (path.length === 0) return;
  let node = root as JsonRecord | unknown[] | null;
  for (let i = 0; i < path.length - 1; i += 1) {
    if (node === null || typeof node !== 'object') return;
    node = (node as Record<string | number, unknown>)[path[i]] as JsonRecord | unknown[] | null;
  }
  if (node === null || typeof node !== 'object') return;
  (node as Record<string | number, unknown>)[path[path.length - 1]] = value;
}

// ---------- 增删字段 / 表格行（直接修改 draft 中的原始 JSON） ----------

export interface TableRowTarget {
  parts: Path;
  kind: TableKind;
  columns: string[];
  templateOwned?: boolean;
}

/** 在指定对象末尾新增字段；名称为空或与现有字段重名时返回 false */
export function addFieldAt(root: unknown, parts: Path, name: string, value: unknown): boolean {
  const node = getAtPath(root, parts);
  const key = name.trim();
  if (!isRecord(node) || !key || Object.prototype.hasOwnProperty.call(node, key)) return false;
  node[key] = value;
  return true;
}

export function removeFieldAt(root: unknown, path: Path): boolean {
  if (path.length === 0) return false;
  const parent = getAtPath(root, path.slice(0, -1));
  const key = path[path.length - 1];
  if (!isRecord(parent) || !Object.prototype.hasOwnProperty.call(parent, key)) return false;
  delete parent[key];
  return true;
}

/** 追加一行空值：对象数组补全所有列名，二维数组按列数补空单元格 */
export function addTableRowAt(root: unknown, table: TableRowTarget): boolean {
  let node = getAtPath(root, table.parts);
  if (table.templateOwned && isEmptyValue(node) && table.parts.length === 2 && isRecord(root)) {
    const [groupKey, tableKey] = table.parts;
    if (isEmptyValue(root[groupKey])) root[groupKey] = {};
    const group = root[groupKey];
    if (isRecord(group)) {
      node = [];
      group[tableKey] = node;
    }
  }
  if (!Array.isArray(node)) return false;
  if (table.kind === 'matrix') {
    node.push(table.columns.map(() => ''));
  } else {
    node.push(Object.fromEntries(table.columns.map((column) => [column, ''])));
  }
  return true;
}

export function removeTableRowAt(root: unknown, parts: Path, index: number): boolean {
  const node = getAtPath(root, parts);
  if (!Array.isArray(node) || index < 0 || index >= node.length) return false;
  node.splice(index, 1);
  return true;
}

/** 顶层/嵌套对象的标量字段；对象数组交给 collectTableSections */
export function collectFieldSections(value: unknown, path: Path = []): FieldSection[] {
  if (!isRecord(value)) return [];

  const rows: FieldRow[] = Object.entries(value)
    .filter(([, item]) => isDisplayableLeaf(item))
    .map(([key, item]) => ({
      path: [...path, key],
      key,
      value: item,
      editable: isDisplayableLeaf(item),
    }));
  const sections: FieldSection[] = rows.length > 0 ? [{ path: path.join('.'), parts: path, rows }] : [];

  for (const [key, item] of Object.entries(value)) {
    if (isRecord(item)) {
      sections.push(...collectFieldSections(item, [...path, key]));
    }
  }
  return sections;
}

function isMatrix(value: unknown[]): value is unknown[][] {
  return (
    value.length > 0 &&
    value.every(
      (row) => Array.isArray(row) && row.every((cell) => !Array.isArray(cell) && !isRecord(cell)),
    )
  );
}

/** 对象数组 / 二维数组 → 数据表；嵌套对象数组继续展开为独立表 */
export function collectTableSections(value: unknown, path: Path = []): TableSection[] {
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every(isRecord)) {
      const records = value as JsonRecord[];
      const columns = Array.from(new Set(records.flatMap((row) => Object.keys(row))));
      const rows: TableRow[] = records.map((row, index) => ({
        path: [...path, index],
        cells: columns.map((column) => {
          const cell = row[column];
          return {
            path: [...path, index, column],
            value: cell,
            editable: isDisplayableLeaf(cell),
          };
        }),
      }));
      const tables: TableSection[] = [{ path: path.join('.'), parts: path, kind: 'records', columns, rows }];
      records.forEach((row, index) => {
        for (const [key, item] of Object.entries(row)) {
          if (isRecord(item) || Array.isArray(item)) {
            tables.push(...collectTableSections(item, [...path, index, key]));
          }
        }
      });
      return tables;
    }

    if (isMatrix(value)) {
      const columnCount = Math.max(...value.map((row) => row.length));
      const columns = Array.from({ length: columnCount }, (_, index) => `${index + 1}`);
      return [
        {
          path: path.join('.'),
          parts: path,
          kind: 'matrix',
          columns,
          rows: value.map((row, rowIndex) => ({
            path: [...path, rowIndex],
            cells: columns.map((_, columnIndex) => ({
              path: [...path, rowIndex, columnIndex],
              value: row[columnIndex],
              editable: isScalar(row[columnIndex]),
            })),
          })),
        },
      ];
    }

    return value.flatMap((item, index) =>
      isRecord(item) || Array.isArray(item) ? collectTableSections(item, [...path, index]) : [],
    );
  }

  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, item]) =>
      isRecord(item) || Array.isArray(item) ? collectTableSections(item, [...path, key]) : [],
    );
  }

  return [];
}

function genericSections(value: unknown, path: Path = []): StructuredSection[] {
  return [
    ...collectFieldSections(value, path).map<StructuredSection>((section) => ({ kind: 'fields', section })),
    ...collectTableSections(value, path).map<StructuredSection>((section) => ({ kind: 'table', section })),
  ];
}

/** D14: preserve group/item/column order, absent template items and all user-added extras. */
export function collectStructuredGroups(
  value: unknown,
  schema?: TemplateSchema | null,
): StructuredGroup[] {
  if (!schema) return [{ key: '', sections: genericSections(value) }];
  const groups: StructuredGroup[] = schema.groups.map((group) => {
    const parts: Path = [group.key];
    const data = getAtPath(value, parts);
    const sections: StructuredSection[] = [];
    const nestedTables: TableSection[] = [];
    for (const item of group.items) {
      const path: Path = [...parts, item.key];
      const current = getAtPath(value, path);
      if (item.kind === 'field') {
        const row: FieldRow = {
          path, key: item.key, value: current, editable: isDisplayableLeaf(current),
          name: item.name, templateOwned: true, required: item.required, type: item.type,
        };
        const last = sections[sections.length - 1];
        if (last?.kind === 'fields') last.section.rows.push(row);
        else sections.push({
          kind: 'fields',
          section: { path: group.key, parts, name: group.name, templateOwned: true, rows: [row] },
        });
      } else {
        const records = Array.isArray(current) ? current : [];
        const columns = Array.from(new Set([
          ...item.columns.map((column) => column.key),
          ...records.flatMap((record) => isRecord(record) ? Object.keys(record) : []),
        ]));
        const columnMetadata: FieldMetadata[] = columns.map((key) => {
          const column = item.columns.find((candidate) => candidate.key === key);
          return column ? {
            name: column.name, templateOwned: true, required: column.required, type: column.type,
          } : {};
        });
        const rows = records.map<TableRow>((record, index) => ({
          path: [...path, index],
          cells: columns.map((key, columnIndex) => {
            const cell = getAtPath(record, [key]);
            return {
              path: [...path, index, key], value: cell, editable: isDisplayableLeaf(cell),
              ...columnMetadata[columnIndex],
            };
          }),
        }));
        sections.push({ kind: 'table', section: {
          path: path.join('.'), parts: path, kind: 'records', name: item.name,
          templateOwned: true, columns, columnMetadata, rows,
        } });
        records.forEach((record, index) => {
          if (!isRecord(record)) return;
          for (const [key, cell] of Object.entries(record)) {
            if (isRecord(cell) || Array.isArray(cell)) {
              nestedTables.push(...collectTableSections(cell, [...path, index, key]));
            }
          }
        });
      }
    }
    const keys = new Set(group.items.map((item) => item.key));
    const extras = isRecord(data)
      ? Object.fromEntries(Object.entries(data).filter(([key]) => !keys.has(key)))
      : {};
    const extraSections = genericSections(extras, parts);
    // Keep one Add field entry for every group, including a table-only group.
    const extraFields = extraSections.find((entry) => entry.kind === 'fields' && entry.section.path === group.key);
    const last = sections[sections.length - 1];
    if (last?.kind === 'fields') {
      if (extraFields?.kind === 'fields') last.section.rows.push(...extraFields.section.rows);
    } else {
      sections.push({ kind: 'fields', section: {
        path: group.key, parts, name: group.name, templateOwned: true,
        rows: extraFields?.kind === 'fields' ? extraFields.section.rows : [],
      } });
    }
    sections.push(...extraSections.filter((entry) => entry !== extraFields));
    sections.push(...nestedTables.map<StructuredSection>((section) => ({ kind: 'table', section })));
    return { key: group.key, name: group.name, sections };
  });
  const groupKeys = new Set(schema.groups.map((group) => group.key));
  const extras = isRecord(value)
    ? Object.fromEntries(Object.entries(value).filter(([key]) => !groupKeys.has(key)))
    : value;
  const extraSections = genericSections(extras);
  if (extraSections.length) groups.push({ key: '', sections: extraSections });
  return groups;
}
