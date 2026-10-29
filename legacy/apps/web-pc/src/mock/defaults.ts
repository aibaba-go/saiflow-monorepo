import type { DocumentType, Settings } from '../api/types';

/** 置信度阈值（EPIC-02 §4.4）：低于该值的字段标记 needs_review。 */
export const CONFIDENCE_THRESHOLD = 0.85;

/** 列表分页默认每页条数（EPIC-05 §3）。 */
export const PAGE_SIZE_DEFAULT = 20;

/** 上传限制（EPIC-01 §3）：仅 JPG/PNG/PDF、单文件 ≤ 20 MB。 */
export const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'pdf'] as const;
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export const ALL_DOC_TYPES: DocumentType[] = ['PO', 'DELIVERY_NOTE', 'INVOICE', 'RECEIPT'];

/**
 * 默认系统设置（DM-Settings，scope=system）。
 * 复核级别默认：Delivery Note 0 级、Receipt 1 级、PO 1 级、Invoice 2 级 —— 覆盖三种策略便于演示。
 */
export const DEFAULT_SETTINGS: Settings = {
  export_save_path: 'C:\\SaiFlow\\Exports',
  archive_naming_rule: '{DocType}_{DocNumber}_{YYYYMMDD}_{Enterprise}.{ext}',
  archive_prefix_template: 'gs://saiflow-documents/{DocType}/{Year}/{Month}/{Enterprise}',
  review_levels: {
    PO: 1,
    DELIVERY_NOTE: 0,
    INVOICE: 2,
    RECEIPT: 1,
  },
};
