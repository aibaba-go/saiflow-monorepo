<script setup lang="ts">
/**
 * 全屏图片 / PDF 页查看器（FR-VERIFY-014）。
 *
 * PDF 由服务端逐页渲染为预览图，因此图片与 PDF 统一传入页图 URL 列表。
 * 手势：双指捏合缩放（以两指中点为焦点）、双击放大/复原、放大后单指拖动平移、
 * 未放大时左右滑动翻页；另提供 −/+ 按钮、点击百分比复原与桌面端滚轮缩放。
 * 页面 viewport 禁用了浏览器原生缩放，故在舞台上以 touch-action: none 自行处理手势。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useT } from '../i18nVue';
import BrandLoading from './BrandLoading.vue';

const props = withDefaults(
  defineProps<{
    sources: string[];
    index?: number;
    alt?: string;
  }>(),
  { index: 0, alt: '' },
);

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'update:index', value: number): void;
}>();

const { t } = useT();

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const BUTTON_STEP = 1.6;
const DOUBLE_TAP_SCALE = 2.5;
const TAP_MOVE_PX = 8;
const TAP_MS = 350;
const DOUBLE_TAP_MS = 300;
const SWIPE_PX = 60;

const total = computed(() => props.sources.length);
const current = ref(Math.min(Math.max(props.index, 0), Math.max(props.sources.length - 1, 0)));
const src = computed(() => props.sources[current.value] ?? '');

const stage = ref<HTMLDivElement | null>(null);
const img = ref<HTMLImageElement | null>(null);
const view = reactive({ s: 1, x: 0, y: 0 });
const animating = ref(false);
const loaded = ref(false);
const failed = ref(false);

const percent = computed(() => Math.round(view.s * 100));
const imgStyle = computed(() => ({
  transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.s})`,
}));

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** 以舞台中心为原点的坐标 */
function toStage(clientX: number, clientY: number): { x: number; y: number } {
  const r = stage.value?.getBoundingClientRect();
  if (!r) return { x: 0, y: 0 };
  return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) };
}

/** 平移边界：放大后的图片不得露出超过舞台的空白 */
function clampPan(s: number, x: number, y: number): { x: number; y: number } {
  const r = stage.value?.getBoundingClientRect();
  const el = img.value;
  if (!r || !el) return { x: 0, y: 0 };
  const mx = Math.max(0, (el.offsetWidth * s - r.width) / 2);
  const my = Math.max(0, (el.offsetHeight * s - r.height) / 2);
  return { x: clamp(x, -mx, mx), y: clamp(y, -my, my) };
}

function setView(s: number, x: number, y: number, animate: boolean): void {
  animating.value = animate;
  view.s = s;
  view.x = x;
  view.y = y;
}

/** 以焦点 (px, py) 不动缩放到 s1 */
function zoomAt(s1: number, px: number, py: number, animate: boolean): void {
  const s = clamp(s1, MIN_SCALE, MAX_SCALE);
  const k = s / view.s;
  const p = clampPan(s, px - (px - view.x) * k, py - (py - view.y) * k);
  setView(s, p.x, p.y, animate);
}

function zoomBy(factor: number): void {
  zoomAt(view.s * factor, 0, 0, true);
}

function resetView(animate = true): void {
  setView(1, 0, 0, animate);
}

/** 手势结束后回弹到合法范围 */
function settle(): void {
  if (view.s <= MIN_SCALE + 0.01) {
    resetView(true);
    return;
  }
  const s = clamp(view.s, MIN_SCALE, MAX_SCALE);
  const p = clampPan(s, view.x, view.y);
  if (s !== view.s || p.x !== view.x || p.y !== view.y) setView(s, p.x, p.y, true);
}

function goTo(next: number): void {
  if (next < 0 || next >= total.value || next === current.value) {
    resetView(true);
    return;
  }
  current.value = next;
  loaded.value = false;
  failed.value = false;
  resetView(false);
  emit('update:index', next);
}

// ---------- 指针手势 ----------

type Gesture =
  | { kind: 'pan' | 'swipe'; startX: number; startY: number; baseX: number; baseY: number }
  | { kind: 'pinch'; startDist: number; baseS: number; baseX: number; baseY: number; midX: number; midY: number };

const pointers = new Map<number, { x: number; y: number }>();
let gesture: Gesture | null = null;
let moved = false;
let tapStart: { x: number; y: number; time: number } | null = null;
let lastTap = { time: 0, x: 0, y: 0 };

function startSingle(x: number, y: number): void {
  gesture = {
    kind: view.s > MIN_SCALE + 0.01 ? 'pan' : 'swipe',
    startX: x,
    startY: y,
    baseX: view.x,
    baseY: view.y,
  };
}

function startPinch(): void {
  const [a, b] = [...pointers.values()];
  const mid = toStage((a.x + b.x) / 2, (a.y + b.y) / 2);
  gesture = {
    kind: 'pinch',
    startDist: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1),
    baseS: view.s,
    baseX: view.x,
    baseY: view.y,
    midX: mid.x,
    midY: mid.y,
  };
}

function onPointerDown(e: PointerEvent): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  try {
    stage.value?.setPointerCapture(e.pointerId);
  } catch {
    // 个别 WebView 对已失效的 pointerId 抛错；不捕获也不影响手势
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  animating.value = false;
  if (pointers.size === 1) {
    moved = false;
    tapStart = { x: e.clientX, y: e.clientY, time: Date.now() };
    startSingle(e.clientX, e.clientY);
  } else if (pointers.size === 2) {
    tapStart = null;
    moved = true;
    startPinch();
  }
}

function onPointerMove(e: PointerEvent): void {
  if (!pointers.has(e.pointerId) || !gesture) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (gesture.kind === 'pinch') {
    if (pointers.size < 2) return;
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = toStage((a.x + b.x) / 2, (a.y + b.y) / 2);
    // 捏合时允许略小于 1 倍以获得回弹手感，松手后复位
    const s = clamp((gesture.baseS * dist) / gesture.startDist, MIN_SCALE * 0.8, MAX_SCALE);
    const k = s / gesture.baseS;
    setView(s, mid.x - (gesture.midX - gesture.baseX) * k, mid.y - (gesture.midY - gesture.baseY) * k, false);
    return;
  }

  const dx = e.clientX - gesture.startX;
  const dy = e.clientY - gesture.startY;
  if (Math.hypot(dx, dy) > TAP_MOVE_PX) moved = true;
  if (gesture.kind === 'pan') {
    const p = clampPan(view.s, gesture.baseX + dx, gesture.baseY + dy);
    setView(view.s, p.x, p.y, false);
  } else if (total.value > 1) {
    setView(1, dx, 0, false);
  }
}

function endPointer(e: PointerEvent, cancelled: boolean): void {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  const g = gesture;

  if (pointers.size === 1) {
    // 捏合中抬起一指：剩余手指继续拖动，不触发翻页
    const [p] = [...pointers.values()];
    gesture = { kind: 'pan', startX: p.x, startY: p.y, baseX: view.x, baseY: view.y };
    return;
  }
  if (pointers.size > 0) return;
  gesture = null;

  if (!cancelled && g?.kind === 'swipe' && moved && total.value > 1) {
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      goTo(current.value + (dx < 0 ? 1 : -1));
      return;
    }
  }

  if (!cancelled && tapStart && !moved && Date.now() - tapStart.time < TAP_MS) {
    handleTap(e);
  }
  tapStart = null;
  settle();
}

function handleTap(e: PointerEvent): void {
  const now = Date.now();
  if (now - lastTap.time < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
    lastTap.time = 0;
    if (view.s > MIN_SCALE + 0.05) {
      resetView(true);
    } else {
      const p = toStage(e.clientX, e.clientY);
      zoomAt(DOUBLE_TAP_SCALE, p.x, p.y, true);
    }
    return;
  }
  lastTap = { time: now, x: e.clientX, y: e.clientY };
  // 未放大时点击图片以外的暗色区域关闭
  if (view.s <= MIN_SCALE + 0.01 && !insideImage(e.clientX, e.clientY)) emit('close');
}

function insideImage(x: number, y: number): boolean {
  const r = img.value?.getBoundingClientRect();
  return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function onWheel(e: WheelEvent): void {
  const p = toStage(e.clientX, e.clientY);
  zoomAt(view.s * Math.exp(-e.deltaY * 0.0015), p.x, p.y, false);
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close');
  else if (e.key === 'ArrowLeft') goTo(current.value - 1);
  else if (e.key === 'ArrowRight') goTo(current.value + 1);
  else if (e.key === '+' || e.key === '=') zoomBy(BUTTON_STEP);
  else if (e.key === '-') zoomBy(1 / BUTTON_STEP);
  else if (e.key === '0') resetView(true);
}

/** iOS WebKit 的私有手势事件：阻止页面级缩放 */
function preventGesture(e: Event): void {
  e.preventDefault();
}

let prevOverflow = '';

onMounted(() => {
  prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', settle);
  document.addEventListener('gesturestart', preventGesture);
  document.addEventListener('gesturechange', preventGesture);
});

onBeforeUnmount(() => {
  document.body.style.overflow = prevOverflow;
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('resize', settle);
  document.removeEventListener('gesturestart', preventGesture);
  document.removeEventListener('gesturechange', preventGesture);
});
</script>

<template>
  <Teleport to="body">
    <div class="iv" role="dialog" aria-modal="true" :aria-label="alt">
      <div
        ref="stage"
        class="iv-stage"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="endPointer($event, false)"
        @pointercancel="endPointer($event, true)"
        @wheel.prevent="onWheel"
      >
        <img
          ref="img"
          :key="src"
          class="iv-img"
          :class="{ animating, ready: loaded }"
          :src="src"
          :alt="alt"
          :style="imgStyle"
          draggable="false"
          @load="loaded = true"
          @error="failed = true"
        />
        <BrandLoading v-if="!loaded && !failed" class="iv-loading" variant="inline" :label="t('common.loading')" />
        <p v-if="failed" class="iv-error">{{ t('viewer.loadFailed') }}</p>
      </div>

      <div class="iv-top">
        <span v-if="total > 1" class="iv-count">{{ current + 1 }} / {{ total }}</span>
        <button class="iv-round iv-close" :aria-label="t('common.close')" @click="emit('close')">×</button>
      </div>

      <button
        v-if="total > 1 && current > 0"
        class="iv-round iv-nav prev"
        :aria-label="t('viewer.prev')"
        @click="goTo(current - 1)"
      >
        ‹
      </button>
      <button
        v-if="total > 1 && current < total - 1"
        class="iv-round iv-nav next"
        :aria-label="t('viewer.next')"
        @click="goTo(current + 1)"
      >
        ›
      </button>

      <div class="iv-bottom">
        <div class="iv-tools">
          <button class="iv-tool" :disabled="view.s <= MIN_SCALE + 0.01" :aria-label="t('viewer.zoomOut')" @click="zoomBy(1 / BUTTON_STEP)">−</button>
          <button class="iv-tool iv-pct" :aria-label="t('viewer.reset')" @click="resetView(true)">{{ percent }}%</button>
          <button class="iv-tool" :disabled="view.s >= MAX_SCALE - 0.01" :aria-label="t('viewer.zoomIn')" @click="zoomBy(BUTTON_STEP)">+</button>
        </div>
        <div class="iv-hint">{{ t('viewer.hint') }}</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.iv {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(10, 12, 16, 0.94);
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  overscroll-behavior: contain;
}

.iv-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  touch-action: none;
  cursor: grab;
}

.iv-img {
  flex: none;
  max-width: calc(100% - 24px);
  max-height: calc(100% - 150px);
  object-fit: contain;
  background: #fff;
  border-radius: 6px;
  transform-origin: center center;
  will-change: transform;
  -webkit-user-drag: none;
  pointer-events: none;
  opacity: 0;
}

.iv-img.ready {
  opacity: 1;
}

.iv-img.animating {
  transition: transform 0.2s ease;
}

.iv-loading,
.iv-error {
  position: absolute;
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
}

.iv-top,
.iv-bottom {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  pointer-events: none;
}

.iv-top {
  top: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: calc(env(safe-area-inset-top, 0px) + 14px) 16px 0;
}

.iv-top > *,
.iv-bottom > *,
.iv-nav {
  pointer-events: auto;
}

.iv-count {
  margin-right: auto;
  padding: 5px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
}

.iv-round {
  width: 38px;
  height: 38px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: 24px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.iv-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  font-size: 28px;
}

.iv-nav.prev {
  left: 10px;
}

.iv-nav.next {
  right: 10px;
}

.iv-bottom {
  bottom: 0;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 0 16px calc(env(safe-area-inset-bottom, 0px) + 16px);
}

.iv-tools {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
}

.iv-tool {
  min-width: 40px;
  height: 36px;
  padding: 0 8px;
  border-radius: 999px;
  color: #fff;
  font-size: 20px;
  font-weight: 600;
  line-height: 1;
}

.iv-tool:disabled {
  opacity: 0.35;
}

.iv-pct {
  min-width: 64px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.iv-hint {
  color: rgba(255, 255, 255, 0.75);
  font-size: 11px;
  text-align: center;
}
</style>
