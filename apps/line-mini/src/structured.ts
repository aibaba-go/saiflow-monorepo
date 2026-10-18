/**
 * structured OCR JSON 的表格化视图与按路径编辑。
 * TextIn Prompt 模式返回任意嵌套的 key-value + 对象数组；这里统一折算成
 * 「字段表 + 数据表」，并保留每个值在原始 JSON 中的路径，供核验页就地修改。
 */

export type Path = (string | number)[];
export type JsonRecord = Record<string, unknown>;

export interface FieldRow {
  path: Path;
  key: string;
  value: unknown;
  editable: boolean;
}

export interface FieldSection {
  path: string;
  rows: FieldRow[];
}

export interface TableCell {
  path: Path;
  value: unknown;
  editable: boolean;
}

export interface TableRow {
  path: Path;
  cells: TableCell[];
}

export interface TableSection {
  path: string;
  columns: string[];
  rows: TableRow[];
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

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    if (value.every((item) => isScalar(item))) {
      return value.map((item) => (item === null || item === undefined ? '—' : String(item))).join('\n');
    }
  }
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

export function inputText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
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
  const sections: FieldSection[] = rows.length > 0 ? [{ path: path.join('.'), rows }] : [];

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
      const tables: TableSection[] = [{ path: path.join('.'), columns, rows }];
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
