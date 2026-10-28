<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ApiError, listJobs, type JobStage, type JobSummary } from '../api';
import { messageText } from '../i18n';
import { useT } from '../i18nVue';
import { currentTenant, currentTenantId, navigate } from '../store';
import BrandLoading from '../components/BrandLoading.vue';
import JobListItem from '../components/JobListItem.vue';

const { t } = useT();

const jobs = ref<JobSummary[]>([]);
const loading = ref(true);
const errorMsg = ref('');
const keyword = ref('');
type Filter = 'ALL' | JobStage;
const filter = ref<Filter>('ALL');

const filters: Filter[] = ['ALL', 'OCR_PROCESSING', 'OCR_FAILED', 'VERIFYING', 'VERIFIED', 'COMPLETED'];

const PAGE_SIZE = 20;
const page = ref(0);
const hasMore = ref(true);
const loadingMore = ref(false);
const sentinel = ref<HTMLElement | null>(null);
let seq = 0;

async function fetchPage(reset: boolean) {
  const mySeq = reset ? ++seq : seq;
  const next = reset ? 1 : page.value + 1;
  if (reset) {
    loading.value = true;
    hasMore.value = true;
  } else {
    loadingMore.value = true;
  }
  errorMsg.value = '';
  try {
    const data = await listJobs({
      page: next,
      page_size: PAGE_SIZE,
      stage: filter.value === 'ALL' ? undefined : filter.value,
      q: keyword.value.trim() || undefined,
      tenantId: currentTenantId.value,
    });
    if (mySeq !== seq) return;
    jobs.value = reset ? data.items : [...jobs.value, ...data.items];
    page.value = next;
    hasMore.value = next * PAGE_SIZE < data.total;
  } catch (e) {
    if (mySeq !== seq) return;
    errorMsg.value = e instanceof ApiError ? messageText(e.messageKey) : t('common.unknownError');
    hasMore.value = false;
  } finally {
    if (mySeq === seq) {
      loading.value = false;
      loadingMore.value = false;
      void nextTick(recheckSentinel);
    }
  }
}

// 首页数据不足一屏时哨兵一直可见，观察器不会再触发，重新 observe 以补发一次回调
function recheckSentinel() {
  if (!observer || !sentinel.value || !hasMore.value) return;
  observer.unobserve(sentinel.value);
  observer.observe(sentinel.value);
}

function load() {
  return fetchPage(true);
}

function loadMore() {
  if (loading.value || loadingMore.value || !hasMore.value) return;
  void fetchPage(false);
}

let observer: IntersectionObserver | null = null;

onMounted(() => {
  void load();
  observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) loadMore();
  }, { rootMargin: '120px' });
  watch(sentinel, (el, old) => {
    if (old) observer?.unobserve(old);
    if (el) observer?.observe(el);
  }, { immediate: true });
});

onBeforeUnmount(() => observer?.disconnect());

watch(() => currentTenantId.value, load);
watch(filter, load);

let kwTimer: ReturnType<typeof setTimeout> | undefined;
watch(keyword, () => {
  clearTimeout(kwTimer);
  kwTimer = setTimeout(load, 300);
});
onBeforeUnmount(() => clearTimeout(kwTimer));

function tenantLabel(): string {
  const tenant = currentTenant.value;
  if (!tenant || tenant.tenant_type === 'PERSONAL') return t('home.workspacePersonal');
  return tenant.name || t('my.company');
}

function openJob(job: JobSummary) {
  const route =
    job.stage === 'OCR_PROCESSING' ? 'processing' : job.stage === 'COMPLETED' ? 'final' : 'result';
  navigate(route, { jobId: job.id });
}
</script>

<template>
  <div class="history">
    <header class="history-header">
      <h1>{{ t('history.title') }}</h1>
      <div class="ws-pill">{{ tenantLabel() }}</div>
    </header>

    <div class="content">
      <div class="search-card">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#99A1B0" stroke-width="2" stroke-linecap="round">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input v-model="keyword" class="search-input" :placeholder="t('history.searchPlaceholder')" />
      </div>

      <div class="filter-row">
        <button
          v-for="f in filters"
          :key="f"
          class="filter-chip"
          :class="{ active: filter === f }"
          @click="filter = f"
        >
          {{ f === 'ALL' ? t('history.filter.all') : t(`job.stage.${f}`) }}
        </button>
      </div>

      <p v-if="errorMsg" class="status-error">{{ errorMsg }}</p>
      <BrandLoading v-if="loading" variant="page" :label="t('common.loading')" />
      <div v-else-if="jobs.length === 0" class="status-line">{{ t('history.empty') }}</div>
      <template v-else>
        <div class="task-list">
          <JobListItem v-for="job in jobs" :key="job.id" :job="job" @open="openJob" />
        </div>
        <div ref="sentinel" class="list-foot">
          <BrandLoading v-if="loadingMore" variant="inline" :label="t('history.loadingMore')" />
          <span v-else-if="!hasMore && page > 1">{{ t('history.noMore') }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.history {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 20px 12px;
}

.history-header h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
}

.ws-pill {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--icon);
  max-width: 150px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.content {
  padding: 0 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.search-card {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 0 14px;
  height: 44px;
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 12px;
  background: transparent;
  color: var(--text);
}

.search-input::placeholder {
  color: var(--text-secondary);
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.filter-chip {
  white-space: nowrap;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--card);
  border: 1px solid var(--border);
  font-size: 11px;
  font-weight: 600;
  color: var(--icon);
}

.filter-chip.active {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.status-line {
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary);
  padding: 24px 0;
}

.status-error {
  margin: 0;
  text-align: center;
  font-size: 12px;
  color: var(--danger);
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.list-foot {
  min-height: 24px;
  text-align: center;
  font-size: 11px;
  color: var(--text-secondary);
}
</style>
