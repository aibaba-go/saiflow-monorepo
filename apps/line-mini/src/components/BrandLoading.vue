<script setup lang="ts">
withDefaults(defineProps<{
  label: string;
  variant?: 'splash' | 'page' | 'inline' | 'button';
  tagline?: string;
  announce?: boolean;
}>(), { variant: 'page', tagline: '', announce: true });
</script>

<template>
  <span
    class="brand-loading"
    :class="`brand-loading--${variant}`"
    role="status"
    :aria-live="announce ? 'polite' : 'off'"
    :aria-label="`saiflow ${label}`"
  >
    <span class="bl-emblem" aria-hidden="true">
      <span class="bl-halo" />
      <span class="bl-orbit" />
      <span class="bl-mark">
        <svg viewBox="0 0 40 40" fill="none">
          <path d="M12 27V13h11M12 20h8" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" />
          <circle cx="27.5" cy="26.5" r="2.5" fill="currentColor" />
        </svg>
        <span class="bl-scan" />
      </span>
    </span>
    <span class="bl-word" aria-hidden="true">saiflow</span>
    <span v-if="tagline" class="bl-tagline">{{ tagline }}</span>
    <span class="bl-label">{{ label }}</span>
    <span class="bl-dots" aria-hidden="true"><i /><i /><i /></span>
  </span>
</template>

<style scoped>
.brand-loading {
  --bl-color: var(--primary, #4a66f7);
  --bl-mark-bg: var(--bl-color);
  --bl-mark-ink: #fff;
  --bl-line: rgba(74, 102, 247, 0.14);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  min-width: 0;
  padding: 24px 0;
  color: var(--bl-color);
}

.bl-emblem {
  position: relative;
  display: grid;
  place-items: center;
  width: 90px;
  height: 90px;
  flex-shrink: 0;
}

.bl-halo {
  position: absolute;
  inset: 0;
  border: 1px solid var(--bl-line);
  border-radius: 50%;
  animation: bl-breathe 2.4s ease-in-out infinite;
}

.bl-halo::after {
  content: '';
  position: absolute;
  inset: 8px;
  border: 1px solid var(--bl-line);
  border-radius: 50%;
  opacity: 0.55;
}

.bl-orbit {
  position: absolute;
  inset: 0;
  animation: bl-orbit 2.6s linear infinite;
}

.bl-orbit::after {
  content: '';
  position: absolute;
  top: -2px;
  left: 50%;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--bl-color);
  box-shadow: 0 0 12px var(--bl-line);
}

.bl-mark {
  position: relative;
  width: 58px;
  height: 58px;
  overflow: hidden;
  border-radius: 17px;
  background: var(--bl-mark-bg);
  color: var(--bl-mark-ink);
  box-shadow: 0 10px 22px rgba(74, 102, 247, 0.16);
}

.bl-mark svg {
  display: block;
  width: 100%;
  height: 100%;
}

.bl-mark circle {
  animation: bl-dot 1.2s ease-in-out infinite;
}

.bl-scan {
  position: absolute;
  inset: 0;
  background: linear-gradient(transparent 40%, var(--bl-mark-ink) 50%, transparent 60%);
  animation: bl-scan 2.4s ease-in-out infinite;
}

.bl-word {
  flex-shrink: 0;
  font-size: 24px;
  font-weight: 750;
  letter-spacing: -0.8px;
  line-height: 1.2;
  white-space: nowrap;
}

.bl-label {
  max-width: 100%;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.5;
  color: var(--icon, #596170);
  text-align: center;
  overflow-wrap: anywhere;
}

.bl-tagline {
  font-size: 11px;
  opacity: 0.75;
}

.bl-dots {
  display: flex;
  gap: 5px;
}

.bl-dots i {
  width: 4px;
  height: 4px;
  background: var(--bl-color);
  border-radius: 50%;
  animation: bl-dot 1.2s ease-in-out infinite;
}

.bl-dots i:nth-child(2) { animation-delay: 0.16s; }
.bl-dots i:nth-child(3) { animation-delay: 0.32s; }

.brand-loading--splash {
  --bl-color: #fff;
  --bl-mark-bg: #fff;
  --bl-mark-ink: var(--primary, #4a66f7);
  --bl-line: rgba(255, 255, 255, 0.2);
  gap: 14px;
}

.brand-loading--splash .bl-emblem { width: 112px; height: 112px; }
.brand-loading--splash .bl-mark { width: 72px; height: 72px; border-radius: 21px; }
.brand-loading--splash .bl-word { font-size: 30px; }
.brand-loading--splash .bl-label { color: rgba(255, 255, 255, 0.8); }

.brand-loading--inline,
.brand-loading--button {
  display: inline-flex;
  flex-direction: row;
  gap: 8px;
  width: auto;
  max-width: 100%;
  padding: 0;
  vertical-align: middle;
}

.brand-loading--inline .bl-emblem,
.brand-loading--inline .bl-mark { width: 30px; height: 30px; border-radius: 9px; }
.brand-loading--inline .bl-word { font-size: 15px; letter-spacing: -0.4px; }
.brand-loading--inline .bl-label { min-width: 0; text-align: start; }

.brand-loading--button {
  --bl-color: currentColor;
  --bl-mark-bg: rgba(255, 255, 255, 0.18);
  --bl-mark-ink: currentColor;
  flex-wrap: wrap;
  gap: 6px;
  color: inherit;
}

.brand-loading--button .bl-emblem,
.brand-loading--button .bl-mark { width: 24px; height: 24px; border-radius: 7px; }
.brand-loading--button .bl-word { font-size: 14px; letter-spacing: -0.4px; }
.brand-loading--button .bl-label { min-width: 0; font-size: 11px; color: inherit; }

.brand-loading--inline .bl-mark,
.brand-loading--button .bl-mark { box-shadow: none; }
.brand-loading--inline .bl-halo,
.brand-loading--inline .bl-orbit,
.brand-loading--inline .bl-dots,
.brand-loading--button .bl-halo,
.brand-loading--button .bl-orbit,
.brand-loading--button .bl-dots { display: none; }

@keyframes bl-orbit { to { transform: rotate(360deg); } }
@keyframes bl-breathe { 50% { opacity: 0.5; transform: scale(0.97); } }
@keyframes bl-dot { 0%, 80%, 100% { opacity: 0.3; } 40% { opacity: 1; } }
@keyframes bl-scan {
  0%, 12% { transform: translateY(-100%); opacity: 0; }
  25%, 75% { opacity: 0.18; }
  90%, 100% { transform: translateY(100%); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .brand-loading *,
  .brand-loading *::after { animation: none !important; }
  .bl-scan { display: none; }
}
</style>
