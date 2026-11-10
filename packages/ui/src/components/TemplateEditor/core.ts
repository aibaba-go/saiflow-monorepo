// antd-free part of the template editor (types, limits, client validation, path helpers);
// exported from the package root so LINE and services can use it without antd.
export {
  CODE_PATTERN,
  COLUMN_ROLES,
  FIELD_ROLES,
  FIELD_TYPES,
  KEY_PATTERN,
  NAME_LANGS,
  TEMPLATE_LIMITS,
  type ColumnRole,
  type ConfirmAttr,
  type FieldRole,
  type FieldType,
  type NameLang,
  type Names,
  type PendingConfirmation,
  type SampleValues,
  type TemplateColumn,
  type TemplateContent,
  type TemplateField,
  type TemplateGroup,
  type TemplateItem,
  type TemplatePathError,
  type TemplateTable,
} from "./types";
export { countTemplate, validateTemplateClient, type TemplateCounts } from "./validate";
export { removeRemap, remapIndexed, slugifyKey, swapRemap, type PathRemap } from "./paths";
export { DEFAULT_TEMPLATE_EDITOR_LABELS, mergeTemplateEditorLabels, type TemplateEditorLabels } from "./labels";
export { DEFAULT_TEMPLATE_ERROR_LABELS, localizeTemplateError, type TemplateErrorLabels } from "./messages";
