import type { Document, NamingRule } from '../api/types';
import { DEFAULT_SETTINGS } from './defaults';

/** 归档文件名/前缀中的安全字符：字母、数字、下划线、连字符。 */
function sanitizeSegment(value: string): string {
  const cleaned = value
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '');
  return cleaned || 'UNKNOWN';
}

/**
 * 归档自动命名（FR-ENTRY-006）：
 * `{DocType}_{DocNumber}_{YYYYMMDD}_{Enterprise}.{ext}` —— 例：
 * INVOICE_INV-2026-001_20260910_ACME.pdf
 */
export function buildArchiveFileName(
  doc: Pick<Document, 'doc_type' | 'doc_number' | 'doc_date' | 'enterprise_name' | 'file_ext'>,
  rule: NamingRule = DEFAULT_SETTINGS.archive_naming_rule,
): string {
  const yyyyMMdd = doc.doc_date ? doc.doc_date.replaceAll('-', '') : 'UNKNOWN';
  return rule
    .replace('{DocType}', doc.doc_type)
    .replace('{DocNumber}', sanitizeSegment(doc.doc_number ?? 'UNKNOWN'))
    .replace('{YYYYMMDD}', yyyyMMdd)
    .replace('{Enterprise}', sanitizeSegment(doc.enterprise_name ?? 'UNKNOWN'))
    .replace('{ext}', doc.file_ext);
}

/**
 * 归档分类前缀（FR-ENTRY-007）：按类型/年/月/企业层级 —— 例：
 * gs://saiflow-documents/INVOICE/2026/09/ACME
 */
export function buildArchivePrefix(
  doc: Pick<Document, 'doc_type' | 'doc_date' | 'enterprise_name'>,
  template: string = DEFAULT_SETTINGS.archive_prefix_template,
): string {
  const year = doc.doc_date ? doc.doc_date.slice(0, 4) : 'UNKNOWN';
  const month = doc.doc_date ? doc.doc_date.slice(5, 7) : 'UNKNOWN';
  return template
    .replace('{DocType}', doc.doc_type)
    .replace('{Year}', year)
    .replace('{Month}', month)
    .replace('{Enterprise}', sanitizeSegment(doc.enterprise_name ?? 'UNKNOWN'));
}
