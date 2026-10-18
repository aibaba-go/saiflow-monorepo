<script setup lang="ts">
import { computed } from 'vue';
import { useT } from '../i18nVue';
import {
  collectFieldSections,
  collectTableSections,
  displayName,
  formatCell,
  inputText,
  type Path,
} from '../structured';

const props = withDefaults(
  defineProps<{
    data: unknown;
    editable?: boolean;
  }>(),
  { editable: false },
);

const emit = defineEmits<{
  (e: 'edit', path: Path, value: string): void;
}>();

const { t } = useT();

const fieldSections = computed(() => collectFieldSections(props.data));
const tableSections = computed(() => collectTableSections(props.data));

function title(path: string, fallback: string): string {
  return path ? displayName(path) : fallback;
}

function onInput(path: Path, event: Event): void {
  emit('edit', path, (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="structured">
    <div v-if="fieldSections.length === 0 && tableSections.length === 0" class="table-empty">
      {{ t('result.noTables') }}
    </div>

    <section
      v-for="(section, index) in fieldSections"
      :key="`field-${section.path}-${index}`"
      class="table-card"
    >
      <div class="table-title">{{ title(section.path, t('result.documentInfo')) }}</div>
      <dl class="detail-list">
        <div v-for="row in section.rows" :key="row.path.join('.')" class="detail-row">
          <dt>{{ displayName(row.key) }}</dt>
          <dd>
            <template v-if="editable && row.editable && Array.isArray(row.value)">
              <input
                v-for="(value, valueIndex) in row.value"
                :key="valueIndex"
                class="cell-input"
                :aria-label="`${displayName(row.key)} ${valueIndex + 1}`"
                :value="inputText(value)"
                @input="onInput([...row.path, valueIndex], $event)"
              />
            </template>
            <input
              v-else-if="editable && row.editable"
              class="cell-input"
              :value="inputText(row.value)"
              @input="onInput(row.path, $event)"
            />
            <span v-else class="cell-text">{{ formatCell(row.value) }}</span>
          </dd>
        </div>
      </dl>
    </section>

    <section
      v-for="(table, index) in tableSections"
      :key="`table-${table.path}-${index}`"
      class="table-card"
    >
      <div class="table-title">{{ title(table.path, t('result.documentTables')) }}</div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th v-for="column in table.columns" :key="column">{{ displayName(column) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in table.rows" :key="rowIndex">
              <td v-for="(cell, cellIndex) in row.cells" :key="cellIndex">
                <template v-if="editable && cell.editable && Array.isArray(cell.value)">
                  <input
                    v-for="(value, valueIndex) in cell.value"
                    :key="valueIndex"
                    class="cell-input"
                    :aria-label="`${displayName(table.columns[cellIndex])} ${valueIndex + 1}`"
                    :value="inputText(value)"
                    @input="onInput([...cell.path, valueIndex], $event)"
                  />
                </template>
                <input
                  v-else-if="editable && cell.editable"
                  class="cell-input"
                  :value="inputText(cell.value)"
                  @input="onInput(cell.path, $event)"
                />
                <span v-else class="cell-text">{{ formatCell(cell.value) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.structured {
  display: flex;
  flex-direction: column;
  gap: 14px;
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

.table-empty {
  padding: 36px 20px;
  border: 1px dashed var(--border);
  border-radius: 14px;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: center;
}
</style>
