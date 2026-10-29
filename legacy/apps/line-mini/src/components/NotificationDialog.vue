<script setup lang="ts">
/**
 * 通知中心（首页铃铛入口）。
 * - 打开即拉取 GET /me/notifications，渲染后立刻 POST /me/notifications/read 全部标记已读；
 * - 标记前的未读项保留「新」标记，让用户看清这次新增了什么，父组件据回调清掉红点；
 * - 到期提醒（PLAN_EXPIRING/PLAN_EXPIRED）文案由后端按用户语言下发，前端只做类型配色。
 */
import { onMounted, ref } from 'vue';
import { ApiError, fetchNotifications, markNotificationsRead, type NotificationItem } from '../api';
import { messageText } from '../i18n';
import { useT } from '../i18nVue';
import BrandLoading from './BrandLoading.vue';
import FormDialog from './FormDialog.vue';

const emit = defineEmits<{ close: []; unread: [count: number] }>();

const { t: tt, d } = useT();

const items = ref<NotificationItem[]>([]);
const loading = ref(true);
const errorMsg = ref('');
/** 本次打开前的未读数，仅用于标题上的「N 条未读」 */
const unreadOnOpen = ref(0);

async function load() {
  loading.value = true;
  errorMsg.value = '';
  try {
    const data = await fetchNotifications();
    items.value = data.items ?? [];
    unreadOnOpen.value = data.unread_count ?? 0;
    if (unreadOnOpen.value > 0) {
      // 打开即已读：失败也不影响列表展示，红点下次刷新时自愈
      try {
        const res = await markNotificationsRead();
        emit('unread', res.unread_count ?? 0);
      } catch {
        emit('unread', unreadOnOpen.value);
      }
    } else {
      emit('unread', 0);
    }
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? messageText(e.messageKey) : tt('notify.loadFailed');
  } finally {
    loading.value = false;
  }
}

onMounted(load);

/** 类型 → 圆点配色（到期相关用警示色，其余用主色） */
function dotClass(type: string): string {
  if (type === 'PLAN_EXPIRED') return 'danger';
  if (type === 'PLAN_EXPIRING') return 'warn';
  return 'info';
}
</script>

<template>
  <FormDialog
    :title="tt('notify.title')"
    :subtitle="unreadOnOpen > 0 ? tt('notify.unread', { n: unreadOnOpen }) : undefined"
  >
    <div v-if="loading" class="nt-status">
      <BrandLoading variant="inline" :label="tt('common.loading')" />
    </div>
    <p v-else-if="errorMsg" class="fd-error nt-retry">{{ errorMsg }}</p>
    <div v-else-if="items.length === 0" class="nt-empty">
      <div class="nt-empty-title">{{ tt('notify.empty') }}</div>
      <p class="nt-empty-hint">{{ tt('notify.emptyHint') }}</p>
    </div>
    <ul v-else class="nt-list">
      <li v-for="n in items" :key="n.id" class="nt-item" :class="{ unread: !n.read }">
        <span class="nt-dot" :class="dotClass(n.type)" />
        <div class="nt-body">
          <div class="nt-title-row">
            <span class="nt-title">{{ n.title }}</span>
            <em v-if="!n.read" class="nt-new">{{ tt('notify.new') }}</em>
          </div>
          <p class="nt-text">{{ n.body }}</p>
          <span class="nt-time">{{ d(n.created_at) }}</span>
        </div>
      </li>
    </ul>

    <div class="fd-actions">
      <button v-if="errorMsg" class="fd-btn secondary" @click="load">{{ tt('common.retry') }}</button>
      <button class="fd-btn primary" @click="emit('close')">{{ tt('common.close') }}</button>
    </div>
  </FormDialog>
</template>

<style scoped>
.nt-status {
  padding: 12px 0;
  text-align: center;
  font-size: 11px;
  color: var(--text-secondary);
}

.nt-retry {
  margin-bottom: 2px;
}

.nt-empty {
  padding: 18px 4px;
  text-align: center;
}

.nt-empty-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}

.nt-empty-hint {
  margin: 6px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.nt-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 46dvh;
  overflow-y: auto;
}

.nt-item {
  display: flex;
  gap: 9px;
  padding: 10px 11px;
  border-radius: 12px;
  background: var(--bg);
}

.nt-item.unread {
  background: var(--primary-light);
}

.nt-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-top: 5px;
  flex-shrink: 0;
  background: var(--primary);
}

.nt-dot.danger {
  background: var(--danger);
}

.nt-dot.warn {
  background: var(--processing);
}

.nt-body {
  flex: 1;
  min-width: 0;
}

.nt-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.nt-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}

.nt-new {
  flex-shrink: 0;
  font-style: normal;
  font-size: 9px;
  font-weight: 800;
  color: var(--primary);
}

.nt-text {
  margin: 3px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.nt-time {
  display: block;
  margin-top: 4px;
  font-size: 9px;
  color: var(--text-secondary);
}
</style>
