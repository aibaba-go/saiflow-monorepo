<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { TemplateSchema } from '../api';
import { useT } from '../i18nVue';
import {
  collectStructuredGroups,
  displayName,
  formatCell,
  getAtPath,
  inputText,
  isEmptyValue,
  isRecord,
  pathText,
  type FieldMetadata,
  type FieldRow,
  type FieldSection,
  type Path,
  type StructuredGroup,
  type TableRowTarget,
  type TableSection,
} from '../structured';

const props = withDefaults(
  defineProps<{
    data: unknown;
    editable?: boolean;
    schema?: TemplateSchema | null;
    typeWarnings?: string[];
  }>(),
  { editable: false },
);

const emit = defineEmits<{
  (e: 'edit', path: Path, value: string): void;
  (e: 'commit', path: Path): void;
  (e: 'add-field', parts: Path, name: string, value: string): void;
  (e: 'remove-field', path: Path): void;
  (e: 'add-row', target: TableRowTarget): void;
  (e: 'remove-row', parts: Path, index: number): void;
}>();

const { t } = useT();

// 删除整段最后一个字段/最后一行表格后，保留一张空卡片，方便再次添加（数据里此时已没有该节）
const emptiedFields = ref<{ path: string; parts: Path }[]>([]);
const emptiedTables = ref<TableSection[]>([]);

const visibleGroups = computed<StructuredGroup[]>(() => {
  const groups = collectStructuredGroups(props.data, props.schema);
  const sections = groups.flatMap((group) => group.sections);
  const groupFor = (parts: Path): StructuredGroup => {
    const key = props.schema?.groups.some((group) => group.key === parts[0]) ? parts[0] : '';
    const existing = groups.find((group) => group.key === key);
    if (existing) return existing;
    const extras: StructuredGroup = { key: '', sections: [] };
    groups.push(extras);
    return extras;
  };
  for (const ghost of emptiedFields.value) {
    if (!sections.some((entry) => entry.kind === 'fields' && entry.section.path === ghost.path)) {
      const group = groupFor(ghost.parts);
      const tableIndex = props.schema ? -1 : group.sections.findIndex((entry) => entry.kind === 'table');
      group.sections.splice(tableIndex < 0 ? group.sections.length : tableIndex, 0,
        { kind: 'fields', section: { ...ghost, rows: [] } });
    }
  }
  for (const ghost of emptiedTables.value) {
    if (!sections.some((entry) => entry.kind === 'table' && entry.section.path === ghost.path)) {
      groupFor(ghost.parts).sections.push({ kind: 'table', section: ghost });
    }
  }
  return groups;
});

// A group can contain fields/table/fields: one add form and one pending commit per object.
const visibleFieldSections = computed<FieldSection[]>(() => Array.from(new Map(
  visibleGroups.value.flatMap((group) => group.sections)
    .flatMap((entry) => entry.kind === 'fields' ? [[entry.section.path, entry.section] as const] : []),
).values()));

const warningPaths = computed(() => new Set(props.typeWarnings ?? []));
const valueElements = new Map<string, HTMLElement>();

/** 新增字段的临时输入（每个字段分区一份） */
const newFields = ref<Record<string, { name: string; value: string }>>({});
const validationRequested = ref(false);
const fieldForms = new Map<string, HTMLFormElement>();
const hasPendingFields = computed(() =>
  Object.values(newFields.value).some((field) => field.name !== '' || field.value !== ''),
);

watch(
  [() => props.data, () => props.schema],
  () => {
    emptiedFields.value = [];
    emptiedTables.value = [];
    newFields.value = {};
    validationRequested.value = false;
  },
);

function title(path: string, fallback: string, name?: string): string {
  return name ?? (path ? (props.schema ? path : displayName(path)) : fallback);
}

function label(key: string, metadata?: FieldMetadata): string {
  return metadata?.name ?? (props.schema ? key : displayName(key));
}

function missing(value: unknown, metadata: FieldMetadata): boolean {
  return !!props.schema && !!metadata.required && isEmptyValue(value);
}

// FR-VERIFY-019：以模板的四种类型为准，不从字段名推断数值键盘。
function inputMode(metadata: FieldMetadata): 'numeric' | 'decimal' | undefined {
  if (metadata.type === 'integer') return 'numeric';
  return metadata.type === 'decimal' || metadata.type === 'amount' ? 'decimal' : undefined;
}

function canShowAddField(group: StructuredGroup, index: number): boolean {
  const entry = group.sections[index];
  return entry.kind === 'fields' && !group.sections.slice(index + 1).some(
    (next) => next.kind === 'fields' && next.section.path === entry.section.path,
  );
}

function setValueElement(path: Path, element: unknown): void {
  const key = pathText(path);
  if (element instanceof HTMLElement) valueElements.set(key, element);
  else valueElements.delete(key);
}

/** D14: locate both frontend required paths and backend structured.<path> errors. */
async function focusMissing(paths: string[]): Promise<void> {
  await nextTick();
  for (const path of paths) {
    const element = valueElements.get(path.replace(/^structured\./, ''));
    if (!element) continue;
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    const target = element.querySelector<HTMLInputElement>('.cell-input') ?? element;
    target.focus({ preventScroll: true });
    return;
  }
}

function onInput(path: Path, event: Event): void {
  emit('edit', path, (event.target as HTMLInputElement).value);
}

function beginAddField(path: string): void {
  newFields.value[path] = { name: '', value: '' };
}

function cancelAddField(path: string): void {
  delete newFields.value[path];
}

function fieldError(section: FieldSection): string {
  const state = newFields.value[section.path];
  const name = state?.name.trim() ?? '';
  if (!name) return t('result.fieldNameRequired');
  const node = getAtPath(props.data, section.parts);
  const templateGroup = props.schema?.groups.find((group) => group.key === section.parts[0]);
  if (!isRecord(node) || Object.prototype.hasOwnProperty.call(node, name)
    || (section.parts.length === 1 && templateGroup?.items.some((item) => item.key === name))) {
    return t('result.fieldNameDuplicate');
  }
  return '';
}

function canAddField(section: FieldSection): boolean {
  return !fieldError(section);
}

function submitAddField(section: FieldSection): void {
  const state = newFields.value[section.path];
  if (!state || !canAddField(section)) return;
  emit('add-field', [...section.parts], state.name.trim(), state.value);
  cancelAddField(section.path);
}

function setFieldForm(path: string, element: unknown): void {
  if (element instanceof HTMLFormElement) fieldForms.set(path, element);
  else fieldForms.delete(path);
}

/** FR-VERIFY-015：Continue 先校验所有新增输入，再同步加入父草稿；失败时不部分提交或导航。 */
function commitPendingFields(): boolean {
  const pending = visibleFieldSections.value.filter((section) => {
    const field = newFields.value[section.path];
    return field && (field.name !== '' || field.value !== '');
  });
  const invalid = pending.find((section) => !canAddField(section));
  if (invalid) {
    validationRequested.value = true;
    const form = fieldForms.get(invalid.path);
    form?.scrollIntoView({ block: 'center' });
    form?.querySelector<HTMLInputElement>('.add-name')?.focus();
    return false;
  }
  pending.forEach(submitAddField);
  // 未输入的空表单不算改动，不额外创建结果版本。
  Object.keys(newFields.value).forEach(cancelAddField);
  validationRequested.value = false;
  return true;
}

defineExpose({ commitPendingFields, hasPendingFields, focusMissing });

function removeField(section: FieldSection, row: FieldRow): void {
  if (row.templateOwned) return;
  if (section.rows.length === 1) {
    // 同一分区反复删空时只保留一张空卡片
    emptiedFields.value = [
      ...emptiedFields.value.filter((g) => g.path !== section.path),
      { path: section.path, parts: [...section.parts] },
    ];
  }
  emit('remove-field', [...row.path]);
}

function addRow(table: TableSection): void {
  emptiedTables.value = emptiedTables.value.filter((g) => g.path !== table.path);
  const target: TableRowTarget = { parts: [...table.parts], kind: table.kind, columns: [...table.columns] };
  if (table.templateOwned) target.templateOwned = true;
  emit('add-row', target);
}

function removeRow(table: TableSection, index: number): void {
  if (table.rows.length === 1) {
    // 同一表格反复删空时只保留一张空卡片
    emptiedTables.value = [
      ...emptiedTables.value.filter((g) => g.path !== table.path),
      { ...table, parts: [...table.parts], rows: [] },
    ];
  }
  emit('remove-row', [...table.parts], index);
}
</script>

<template>
  <div class="structured" :class="{ 'template-view': !!schema }">
    <div v-if="schema" class="schema-name">{{ schema.name }}</div>
    <div v-if="visibleGroups.every((group) => group.sections.length === 0)" class="table-empty">
      {{ t('result.noTables') }}
    </div>
    <div v-for="group in visibleGroups" :key="group.key" class="structured-group">
      <div v-if="schema && group.name !== undefined" class="group-name">{{ group.name }}</div>
      <template v-for="(entry, index) in group.sections" :key="`${entry.kind}-${entry.section.path}-${index}`">
        <template v-if="entry.kind === 'fields'">
          <section
            v-for="section in [entry.section]"
            v-show="section.rows.length > 0 || editable || !section.templateOwned"
            :key="`field-${section.path}-${index}`"
            class="table-card"
          >
            <div v-if="!schema || section.path !== group.key" class="table-title">
              {{ title(section.path, t('result.documentInfo'), section.name) }}
            </div>
            <dl class="detail-list">
              <div
                v-for="row in section.rows"
                :key="row.path.join('.')"
                :ref="(element) => setValueElement(row.path, element)"
                class="detail-row"
                :class="{
                  'with-actions': editable && !row.templateOwned,
                  'required-missing': missing(row.value, row),
                  'type-warning': !!schema && warningPaths.has(pathText(row.path)),
                }"
                tabindex="-1"
              >
                <dt>{{ label(row.key, row) }}<span v-if="row.required" class="required-star"> *</span></dt>
                <dd>
                  <template v-if="editable && row.editable && Array.isArray(row.value)">
                    <input
                      v-for="(value, valueIndex) in row.value"
                      :key="valueIndex"
                      class="cell-input"
                      :aria-label="`${label(row.key, row)} ${valueIndex + 1}`"
                      :aria-required="row.required || undefined"
                      :aria-invalid="missing(row.value, row) || undefined"
                      :inputmode="inputMode(row)"
                      :value="inputText(value, row.key, row.type)"
                      @input="onInput([...row.path, valueIndex], $event)"
                      @change="emit('commit', [...row.path, valueIndex])"
                    />
                  </template>
                  <input
                    v-else-if="editable && row.editable"
                    class="cell-input"
                    :aria-label="label(row.key, row)"
                    :aria-required="row.required || undefined"
                    :aria-invalid="missing(row.value, row) || undefined"
                    :inputmode="inputMode(row)"
                    :value="inputText(row.value, row.key, row.type)"
                    @input="onInput(row.path, $event)"
                    @change="emit('commit', row.path)"
                  />
                  <span v-else class="cell-text">{{ formatCell(row.value, row.key, row.type) }}</span>
                </dd>
                <button
                  v-if="editable && !row.templateOwned"
                  type="button"
                  class="row-delete"
                  :aria-label="`${t('result.deleteField')}: ${label(row.key, row)}`"
                  @click="removeField(section, row)"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path
                      d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12M10 11v5M14 11v5"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </dl>
            <div v-if="editable && canShowAddField(group, index)" class="card-footer">
              <form
                v-if="newFields[section.path]"
                :ref="(element) => setFieldForm(section.path, element)"
                class="add-field-form"
                @submit.prevent="submitAddField(section)"
              >
                <input
                  v-model="newFields[section.path].name"
                  class="add-name"
                  :aria-invalid="validationRequested && !!fieldError(section)"
                  :placeholder="t('result.fieldName')"
                  :aria-label="t('result.fieldName')"
                />
                <input
                  v-model="newFields[section.path].value"
                  class="add-value"
                  :placeholder="t('result.fieldValue')"
                  :aria-label="t('result.fieldValue')"
                />
                <button
                  type="submit"
                  class="form-btn confirm"
                  :disabled="!canAddField(section)"
                  :aria-label="t('result.addField')"
                >
                  +
                </button>
                <button
                  type="button"
                  class="form-btn cancel"
                  :aria-label="t('common.cancel')"
                  @click="cancelAddField(section.path)"
                >
                  ×
                </button>
                <p v-if="validationRequested && fieldError(section)" class="field-error" role="alert">
                  {{ fieldError(section) }}
                </p>
              </form>
              <button v-else type="button" class="add-btn" @click="beginAddField(section.path)">
                + {{ t('result.addField') }}
              </button>
            </div>
          </section>
        </template>
        <template v-else>
          <section
            v-for="table in [entry.section]"
            :key="`table-${table.path}-${index}`"
            class="table-card"
          >
            <div class="table-title">{{ title(table.path, t('result.documentTables'), table.name) }}</div>
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th v-for="(column, columnIndex) in table.columns" :key="column">
                      {{ label(column, table.columnMetadata?.[columnIndex]) }}
                      <span v-if="table.columnMetadata?.[columnIndex]?.required" class="required-star"> *</span>
                    </th>
                    <th v-if="editable" class="row-actions"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, rowIndex) in table.rows" :key="row.path.join('.')">
                    <td
                      v-for="(cell, cellIndex) in row.cells"
                      :key="cellIndex"
                      :ref="(element) => setValueElement(cell.path, element)"
                      :class="{
                        'required-missing': missing(cell.value, cell),
                        'type-warning': !!schema && warningPaths.has(pathText(cell.path)),
                      }"
                      tabindex="-1"
                    >
                      <template v-if="editable && cell.editable && Array.isArray(cell.value)">
                        <input
                          v-for="(value, valueIndex) in cell.value"
                          :key="valueIndex"
                          class="cell-input"
                          :aria-label="`${label(table.columns[cellIndex], cell)} ${valueIndex + 1}`"
                          :aria-required="cell.required || undefined"
                          :aria-invalid="missing(cell.value, cell) || undefined"
                          :inputmode="inputMode(cell)"
                          :value="inputText(value, table.columns[cellIndex], cell.type)"
                          @input="onInput([...cell.path, valueIndex], $event)"
                          @change="emit('commit', [...cell.path, valueIndex])"
                        />
                      </template>
                      <input
                        v-else-if="editable && cell.editable"
                        class="cell-input"
                        :aria-label="label(table.columns[cellIndex], cell)"
                        :aria-required="cell.required || undefined"
                        :aria-invalid="missing(cell.value, cell) || undefined"
                        :inputmode="inputMode(cell)"
                        :value="inputText(cell.value, table.columns[cellIndex], cell.type)"
                        @input="onInput(cell.path, $event)"
                        @change="emit('commit', cell.path)"
                      />
                      <span v-else class="cell-text">{{ formatCell(cell.value, table.columns[cellIndex], cell.type) }}</span>
                    </td>
                    <td v-if="editable" class="row-actions">
                      <button
                        type="button"
                        class="row-delete"
                        :aria-label="t('result.deleteRow')"
                        @click="removeRow(table, rowIndex)"
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                          <path
                            d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12M10 11v5M14 11v5"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.8"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          />
                        </svg>
                      </button>
                    </td>
                  </tr>
                  <tr v-if="table.rows.length === 0">
                    <td :colspan="table.columns.length + 1" class="empty-rows">{{ t('result.emptyTable') }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="editable" class="card-footer">
              <button type="button" class="add-btn" @click="addRow(table)">+ {{ t('result.addRow') }}</button>
            </div>
          </section>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.structured,
.structured-group {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.schema-name,
.group-name {
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  white-space: pre-wrap;
}

.group-name {
  font-size: 12px;
}

.template-view .table-title,
.template-view dt,
.template-view th {
  text-transform: none;
}

.required-star,
.detail-row.required-missing dt,
.required-missing .cell-input,
.required-missing .cell-text {
  color: var(--danger);
}

.required-missing {
  background: #fff1f1;
  box-shadow: inset 0 0 0 1px var(--danger);
}

.type-warning:not(.required-missing) {
  background: #fff8e6;
  box-shadow: inset 0 0 0 1px #b7791f;
}

.table-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
}

.table-title {
  padding: 11px 14px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  font-weight: 700;
  text-transform: capitalize;
}

.detail-list {
  margin: 0;
}

.detail-row {
  display: grid;
  grid-template-columns: minmax(100px, 34%) minmax(0, 1fr);
  border-bottom: 1px solid var(--border);
}

.detail-row.with-actions {
  grid-template-columns: minmax(100px, 34%) minmax(0, 1fr) 34px;
}

.detail-row:last-child {
  border-bottom: 0;
}

.detail-row dt,
.detail-row dd {
  margin: 0;
  padding: 8px 12px;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.detail-row dt {
  border-right: 1px solid var(--border);
  background: var(--primary-light);
  color: var(--primary);
  font-weight: 700;
  text-transform: capitalize;
}

.detail-row dd {
  color: var(--text);
}

.detail-row .row-delete {
  margin: 7px 6px 0 0;
}

.table-scroll {
  overflow-x: auto;
  overscroll-behavior-x: contain;
}

table {
  width: 100%;
  min-width: max-content;
  border-collapse: collapse;
  font-size: 11px;
}

th,
td {
  max-width: 260px;
  padding: 0;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
  white-space: pre-wrap;
  word-break: break-word;
}

th {
  padding: 10px 12px;
  background: var(--primary-light);
  color: var(--primary);
  font-weight: 700;
  text-transform: capitalize;
  white-space: nowrap;
}

td .cell-text {
  display: block;
  padding: 10px 12px;
}

th:last-child,
td:last-child {
  border-right: 0;
}

tbody tr:last-child td {
  border-bottom: 0;
}

th.row-actions,
td.row-actions {
  width: 34px;
  min-width: 34px;
  padding: 0;
  text-align: center;
  vertical-align: middle;
}

.row-delete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 27px;
  height: 27px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--icon);
  cursor: pointer;
}

.row-delete:active {
  background: #fdeaea;
  color: var(--danger);
}

.empty-rows {
  padding: 18px 12px;
  color: var(--text-secondary);
  font-size: 11px;
  text-align: center;
}

.cell-input {
  display: block;
  width: 100%;
  min-width: 96px;
  min-height: 38px;
  padding: 9px 11px;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 11px;
  line-height: 1.5;
}

.cell-input:focus {
  background: #f7f9ff;
  box-shadow: inset 0 0 0 1.5px var(--primary);
}

.detail-row .cell-input {
  min-width: 0;
}

.card-footer {
  display: flex;
  gap: 8px;
  padding: 9px 11px;
  border-top: 1px solid var(--border);
}

.add-btn {
  flex: 1;
  min-height: 36px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  background: transparent;
  color: var(--primary);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.add-btn:active {
  background: var(--primary-light);
}

.add-field-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 36px 36px;
  flex: 1;
  min-width: 0;
  gap: 6px;
  align-items: center;
}

.add-field-form input {
  width: 100%;
  min-width: 0;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: #fff;
  color: var(--text);
  font: inherit;
  font-size: 11px;
  outline: none;
}

.add-field-form input:focus {
  border-color: var(--primary);
}

.field-error {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--danger);
  font-size: 11px;
}

.form-btn {
  flex: 0 0 36px;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 9px;
  font-size: 17px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}

.form-btn.confirm {
  background: var(--primary);
  color: #fff;
}

.form-btn.confirm:disabled {
  opacity: 0.4;
}

.form-btn.cancel {
  background: var(--track);
  color: var(--icon);
}

.table-empty {
  padding: 36px 20px;
  border: 1px dashed var(--border);
  border-radius: 14px;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: center;
}
</style>
