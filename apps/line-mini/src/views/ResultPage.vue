<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ApiError, filePagePreviewUrl, getJob, getJobResults, type JobResults, type JobSummary } from '../api';
import { messageText } from '../i18n';
import { useT } from '../i18nVue';
import { goTab } from '../store';
import PageHeader from '../components/PageHeader.vue';
import StatusChip from '../components/StatusChip.vue';

const { t } = useT();

const props = defineProps<{
  jobId: string;
}>();

type Tab = 'json' | 'table' | 'original';
type JsonRecord = Record<string, unknown>;

interface ResultTable {
  path: string;
  columns: string[];
  rows: unknown[][];
}

interface DetailSection {
  path: string;
  rows: { key: string; value: unknown }[];
}

const tab = ref<Tab>('json');

const results = ref<JobResults | null>(null);
const job = ref<JobSummary | null>(null);
const errorMsg = ref('');
const copied = ref(false);
const activePage = ref(1);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectTables(value: unknown, path: string[] = []): ResultTable[] {
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every(isRecord)) {
      const records = value as JsonRecord[];
      const columns = Array.from(new Set(records.flatMap((row) => Object.keys(row))));
      const rows = records.map((row) => columns.map((column) => row[column]));
      const tables: ResultTable[] = [{ path: path.join('.'), columns, rows }];
      records.forEach((row, index) => {
        tables.push(...collectTables(row, [...path, String(index + 1)]));
      });
      return tables;
    }

    const isMatrix =
      value.length > 0 &&
      value.every(
        (row) =>
          Array.isArray(row) &&
          row.every((cell) => !Array.isArray(cell) && !isRecord(cell)),
      );
    if (isMatrix) {
      const rows = value as unknown[][];
      const columnCount = Math.max(...rows.map((row) => row.length));
      const columns = Array.from({ length: columnCount }, (_, index) => `${index + 1}`);
      return [{ path: path.join('.'), columns, rows }];
    }

    return value.flatMap((item, index) => collectTables(item, [...path, String(index + 1)]));
  }

  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, item]) => collectTables(item, [...path, key]));
  }

  return [];
}

function collectDetailSections(value: unknown, path: string[] = []): DetailSection[] {
  if (!isRecord(value)) return [];

  const entries = Object.entries(value);
  const rows = entries
    .filter(([, item]) => {
      if (isRecord(item)) return false;
      if (!Array.isArray(item)) return true;
      return item.every((entry) => !Array.isArray(entry) && !isRecord(entry));
    })
    .map(([key, item]) => ({ key, value: item }));
  const sections = rows.length > 0 ? [{ path: path.join('.'), rows }] : [];

  entries.forEach(([key, item]) => {
    if (isRecord(item)) {
      sections.push(...collectDetailSections(item, [...path, key]));
    }
  });

  return sections;
}

function displayName(value: string): string {
  return value
    .split('.')
    .map((part) => part.replace(/_/g, ' '))
    .join(' / ');
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    if (value.every((item) => !Array.isArray(item) && !isRecord(item))) {
      return value.map((item) => (item === null || item === undefined ? '—' : String(item))).join('\n');
    }
  }
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

const jsonText = computed(() => JSON.stringify(results.value?.structured ?? {}, null, 2));
const detailSections = computed(() => collectDetailSections(results.value?.structured));
const resultTables = computed(() => collectTables(results.value?.structured));
const pageNumbers = computed(() => {
  const n = job.value?.page_count || results.value?.page_count || 1;
  return Array.from({ length: n }, (_, i) => i + 1);
});

async function load() {
  try {
    [results.value, job.value] = await Promise.all([getJobResults(props.jobId), getJob(props.jobId)]);
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? messageText(e.messageKey) : t('common.unknownError');
  }
}

onMounted(load);

// LINE 内置 WebView 等环境可能不支持/拒绝 Clipboard API，退回 execCommand
function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
}

async function copyJson() {
  errorMsg.value = '';
  let ok = false;
  try {
    await navigator.clipboard.writeText(jsonText.value);
    ok = true;
  } catch {
    ok = legacyCopy(jsonText.value);
  }
  if (ok) {
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } else {
    errorMsg.value = t('result.copyFailed');
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'json', label: 'result.tabJson' },
  { key: 'table', label: 'result.tabTable' },
  { key: 'original', label: 'result.tabOriginal' },
];
</script>

<template>
  <div class="result">
    <PageHeader :title="job?.file_name || '…'" @back="goTab('history')" />

    <div v-if="errorMsg && !results" class="fatal">
      <p class="status-error">{{ errorMsg }}</p>
      <button class="home-btn" @click="goTab('history')">{{ t('common.back') }}</button>
    </div>

    <template v-else-if="results">
      <div class="summary">
        <div class="chips">
          <StatusChip v-if="job" :status="job.status" />
        </div>
        <div class="meta">
          {{ t('result.meta', { pages: job?.page_count ?? results.page_count, tables: results.table_count }) }}
          · {{ t('result.updatedAt', { time: formatTime(job?.finished_at ?? job?.created_at ?? null) }) }}
        </div>
      </div>

      <div class="tabs">
        <button
          v-for="item in TABS"
          :key="item.key"
          class="tab"
          :class="{ active: tab === item.key }"
          @click="tab = item.key"
        >
          {{ t(item.label) }}
        </button>
      </div>

      <div class="tab-content">
        <div v-if="tab === 'json'" class="json-card">
          <div class="json-head">
            <span class="json-title">JSON</span>
            <button class="copy-btn" @click="copyJson">
              {{ copied ? t('result.copied') : t('result.copyJson') }}
            </button>
          </div>
          <pre class="json-body">{{ jsonText }}</pre>
        </div>

        <div v-else-if="tab === 'table'" class="tables-view">
          <div v-if="detailSections.length === 0 && resultTables.length === 0" class="table-empty">
            {{ t('result.noTables') }}
          </div>

          <section v-for="section in detailSections" :key="section.path || 'document'" class="table-card">
            <div class="table-title">
              {{ section.path ? displayName(section.path) : t('result.documentInfo') }}
            </div>
            <dl class="detail-list">
              <div v-for="row in section.rows" :key="row.key" class="detail-row">
                <dt>{{ displayName(row.key) }}</dt>
                <dd>{{ formatCell(row.value) }}</dd>
              </div>
            </dl>
          </section>

          <section v-for="table in resultTables" :key="table.path" class="table-card">
            <div class="table-title">{{ displayName(table.path) }}</div>
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th v-for="column in table.columns" :key="column">
                      {{ displayName(column) }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, rowIndex) in table.rows" :key="rowIndex">
                    <td v-for="(column, columnIndex) in table.columns" :key="column">
                      {{ formatCell(row[columnIndex]) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <template v-else>
          <div class="pager">
            <button
              v-for="p in pageNumbers"
              :key="p"
              class="page-pill"
              :class="{ active: activePage === p }"
              @click="activePage = p"
            >
              {{ p }}
            </button>
          </div>
          <img
            v-if="job"
            class="original"
            :src="filePagePreviewUrl(job.file_id, activePage)"
            :alt="job.file_name"
          />
        </template>
      </div>

      <p v-if="errorMsg" class="status-error">{{ errorMsg }}</p>
    </template>

    <div v-else class="fatal"><p>{{ t('common.loading') }}</p></div>
  </div>
</template>

<style scoped>
.result {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.fatal {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 24px;
}

.summary {
  padding: 2px 20px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chips {
  display: flex;
  gap: 8px;
  align-items: center;
}

.meta {
  font-size: 11px;
  color: var(--text-secondary);
}

.tabs {
  display: flex;
  gap: 20px;
  padding: 0 20px;
  border-bottom: 1px solid var(--border);
}

.tab {
  font-size: 12px;
  color: var(--text-secondary);
  padding: 10px 2px;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  font-weight: 600;
}

.tab.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}

.tab-content {
  flex: 1;
  padding: 14px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

.json-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
}

.json-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}

.json-title {
  font-size: 12px;
  font-weight: 700;
}

.copy-btn {
  height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--primary-light);
  color: var(--primary);
  font-size: 11px;
  font-weight: 700;
}

.json-body {
  margin: 0;
  padding: 14px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text);
}

.tables-view {
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
  padding: 10px 12px;
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
  padding: 10px 12px;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
  white-space: pre-wrap;
  word-break: break-word;
}

th {
  background: var(--primary-light);
  color: var(--primary);
  font-weight: 700;
  text-transform: capitalize;
  white-space: nowrap;
}

th:last-child,
td:last-child {
  border-right: 0;
}

tbody tr:last-child td {
  border-bottom: 0;
}

.table-empty {
  padding: 36px 20px;
  border: 1px dashed var(--border);
  border-radius: 14px;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: center;
}

.pager {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.page-pill {
  min-width: 32px;
  height: 32px;
  border-radius: 999px;
  background: var(--card);
  border: 1px solid var(--border);
  font-size: 11px;
  font-weight: 600;
  color: var(--icon);
}

.page-pill.active {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.original {
  width: 100%;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: var(--card);
}

.status-error {
  margin: 0;
  padding: 0 20px 16px;
  text-align: center;
  font-size: 12px;
  color: var(--danger);
}

.home-btn {
  height: 44px;
  padding: 0 24px;
  border-radius: 12px;
  background: var(--primary-light);
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
}
</style>
