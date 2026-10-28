import { onBeforeUnmount, ref } from 'vue';
import { ApiError, sendEmailCode } from './api';
import { messageText, t } from './i18n';

const AVATAR_SIZE = 256;

/** 选图后居中裁成正方形并缩放为 256px JPEG data URL（服务端仅收 png/jpeg/webp data URL） */
export async function resizeAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error(t('profile.avatarInvalid'));
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(t('profile.avatarInvalid')));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
    ctx.drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_SIZE,
      AVATAR_SIZE,
    );
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isValidEmail(v: string): boolean {
  return v.length <= 254 && EMAIL_RE.test(v);
}

/** Phone is optional; accept common international/local telephone formatting. */
export function isValidPhone(v: string): boolean {
  if (!v) return true;
  const digits = v.replace(/[^0-9]/g, '');
  return v.length <= 32 && /^\+?[0-9() .-]+$/.test(v) && digits.length >= 6 && digits.length <= 15;
}

/** 优先展示字段级错误文案 */
export function apiErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    const field = e.body.field_errors?.[0]?.message_key;
    return messageText(field || e.messageKey);
  }
  return e instanceof Error && e.message ? e.message : t('common.unknownError');
}

/** 邮箱验证码发送状态：记录已发送的邮箱，并做重发倒计时 */
export function useEmailCode() {
  const sentTo = ref('');
  const cooldown = ref(0);
  const sending = ref(false);
  let timer: number | undefined;

  function startCooldown(seconds: number) {
    cooldown.value = seconds;
    window.clearInterval(timer);
    timer = window.setInterval(() => {
      cooldown.value -= 1;
      if (cooldown.value <= 0) {
        cooldown.value = 0;
        window.clearInterval(timer);
      }
    }, 1000);
  }

  onBeforeUnmount(() => window.clearInterval(timer));

  async function send(email: string) {
    sending.value = true;
    try {
      const res = await sendEmailCode(email);
      sentTo.value = email;
      startCooldown(res.cooldown_seconds || 60);
    } finally {
      sending.value = false;
    }
  }

  return { sentTo, cooldown, sending, send };
}
