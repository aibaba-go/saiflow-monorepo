import * as XLSX from 'xlsx';
import type { Document, ExtractedField } from '../../api/types';
import { headerFieldKeys } from '../../mock/dataset';

/**
 * Excel 录入导出（FR-ENTRY-001/002/003）：
 * 按单据类型使用标准化模板（该类型全部头部字段为列），
 * 每份单据一行，映射字段值一键填充；多种类型合并为一个工作簿（每类型一个工作表）。
 */

/** 按类型分组并生成工作簿（纯函数，便于单测校验填充内容）。 */
export function buildExportWorkbook(documents: Document[], fields: ExtractedField[]): XLSX.WorkBook {
  const valueOf = new Map<string, string>();
  for (const field of fields) {
    if (field.value !== null) valueOf.set(`${field.document_id}#${field.field_key}`, field.value);
  }

  const workbook = XLSX.utils.book_new();
  const byType = new Map<Document['doc_type'], Document[]>();
  for (const doc of documents) {
    const list = byType.get(doc.doc_type) ?? [];
    list.push(doc);
    byType.set(doc.doc_type, list);
  }

  for (const [docType, docs] of byType) {
    const columns = headerFieldKeys(docType);
    const rows: (string | null)[][] = [
      columns, // 表头行 = 模板字段键
      ...docs.map((doc) => columns.map((key) => valueOf.get(`${doc.id}#${key}`) ?? null)),
    ];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, docType);
  }
  return workbook;
}

/** 生成 .xlsx 并触发下载；无下载能力的环境（jsdom 测试）仅完成序列化。 */
export function downloadWorkbook(workbook: XLSX.WorkBook, fileName: string): void {
  if (typeof URL.createObjectURL !== 'function') {
    // 测试环境无 createObjectURL：仅验证可序列化，不触发下载
    XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    return;
  }
  XLSX.writeFile(workbook, fileName);
}

/** 导出文件名：SaiFlow_Export_YYYYMMDD-HHmmss.xlsx。 */
export function exportFileName(now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `SaiFlow_Export_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.xlsx`;
}
