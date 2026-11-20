let chinese: Promise<void> | null = null;

/**
 * Load Noto Sans SC when the UI language is Chinese. Its @font-face rules are ~350 kB of CSS
 * (one per character range and weight), too much to block every Thai and English user's
 * first page; until it loads, Chinese text uses the system font (FR-SYS-132).
 */
export function loadChineseFont(): Promise<void> {
  chinese ??= import("./styles/fonts-sc.css").then(() => undefined);
  return chinese;
}
