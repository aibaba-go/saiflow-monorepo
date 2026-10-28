"""FR-SYS-014/016: TLS SMTP verification emails; no credentials or codes in logs.

两类邮件共用同一条发送路径（`_send`）：邮箱验证码（FR-SYS-014/016）与套餐到期
提醒（FR-SYS-012/013）。失败一律收敛为 `EmailDeliveryError('delivery_failed')`，
异常里不带 SMTP 响应、凭据或收件人地址。
"""
from __future__ import annotations

import re
import smtplib
import ssl
from email.headerregistry import Address
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

from flask import current_app


class EmailDeliveryError(Exception):
    """Safe delivery failure: deliberately contains no SMTP response or secrets."""


def _settings() -> dict:
    config = current_app.config
    settings = {
        "host": config.get("MAIL_SMTP_HOST", ""),
        "port": config.get("MAIL_SMTP_PORT", 465),
        "security": config.get("MAIL_SMTP_SECURITY", "ssl"),
        "username": config.get("MAIL_SMTP_USERNAME", ""),
        "password": config.get("MAIL_SMTP_PASSWORD", ""),
        "sender": config.get("MAIL_FROM", ""),
        "timeout": config.get("MAIL_SMTP_TIMEOUT_SECONDS", 10),
    }
    if not all(settings[key] for key in ("host", "username", "password", "sender")):
        raise EmailDeliveryError("not_configured")
    if settings["security"] not in ("ssl", "starttls"):
        raise EmailDeliveryError("tls_required")
    return settings


def ensure_configured() -> None:
    _settings()


def verification_message(sender: str, recipient: str, code: str, *, language: str = "en", ttl_minutes: int = 10) -> EmailMessage:
    if not re.fullmatch(r"[0-9]{6}", code):
        raise ValueError("Verification code must contain six digits")
    if language == "th":
        subject = "รหัสยืนยันอีเมล SaiFlow"
        heading = "ยืนยันอีเมลของคุณ"
        introduction = "กรอกรหัสนี้ใน SaiFlow เพื่อยืนยันอีเมลของคุณ:"
        expiry = f"รหัสนี้ใช้ได้ {ttl_minutes} นาที และใช้ได้เพียงครั้งเดียว"
        warning = "อย่าแชร์รหัสนี้กับผู้อื่น ทีมงาน SaiFlow จะไม่ขอรหัสของคุณ"
        ignore = "หากคุณไม่ได้ขอรหัสนี้ โปรดไม่ต้องดำเนินการใด ๆ"
    else:
        subject = "Your SaiFlow email verification code"
        heading = "Verify your email"
        introduction = "Enter this code in SaiFlow to verify your email address:"
        expiry = f"This code expires in {ttl_minutes} minutes and can only be used once."
        warning = "Do not share this code. SaiFlow support will never ask for it."
        ignore = "If you did not request this code, you can safely ignore this email."

    message = EmailMessage()
    message["From"] = Address("SaiFlow", addr_spec=sender)
    message["To"] = Address(addr_spec=recipient)
    message["Subject"] = subject
    message["Date"] = formatdate(localtime=False, usegmt=True)
    message["Message-ID"] = make_msgid(domain=sender.rsplit("@", 1)[-1])
    message.set_content(f"SaiFlow\n\n{heading}\n\n{introduction}\n\n{code}\n\n{expiry}\n\n{warning}\n\n{ignore}\n")
    message.add_alternative(
        '<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:Arial,sans-serif;color:#172033">'
        '<div style="max-width:520px;margin:32px auto;padding:32px;background:#fff;border-radius:16px">'
        '<div style="font-size:24px;font-weight:700;color:#16866a">SaiFlow</div>'
        f'<h1 style="font-size:22px;margin-top:28px">{heading}</h1><p>{introduction}</p>'
        f'<div style="padding:20px;background:#eef8f4;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px">{code}</div>'
        f'<p>{expiry}</p><p>{warning}</p><p style="font-size:13px;color:#64748b">{ignore}</p>'
        '</div></body></html>',
        subtype="html",
    )
    return message


def send_verification_code(recipient: str, code: str, *, language: str = "en", ttl_minutes: int = 10) -> None:
    settings = _settings()
    try:
        message = verification_message(
            settings["sender"], recipient, code, language=language, ttl_minutes=ttl_minutes
        )
    except (ValueError, OSError):
        # 构造失败（非法验证码/头注入）同样收敛为安全错误，对外语义与改造前一致
        raise EmailDeliveryError("delivery_failed") from None
    _send(message, recipient, settings)


def _send(message: EmailMessage, recipient: str, settings: dict | None = None) -> None:
    """唯一 SMTP 发送路径（SSL 或 starttls），验证码与到期提醒共用。"""
    settings = _settings() if settings is None else settings
    try:
        context = ssl.create_default_context()
        client_type = smtplib.SMTP_SSL if settings["security"] == "ssl" else smtplib.SMTP
        kwargs = {"timeout": settings["timeout"]}
        if settings["security"] == "ssl":
            kwargs["context"] = context
        with client_type(settings["host"], settings["port"], **kwargs) as smtp:
            smtp.ehlo()
            if settings["security"] == "starttls":
                smtp.starttls(context=context)
                smtp.ehlo()
            smtp.login(settings["username"], settings["password"])
            refused = smtp.send_message(message, from_addr=settings["sender"], to_addrs=[recipient])
            if refused:
                raise EmailDeliveryError("recipient_rejected")
    except (smtplib.SMTPException, OSError, ValueError):
        # SMTP exceptions can contain recipient addresses or vendor diagnostics.
        # Never expose them in HTTP responses or log a traceback containing credentials.
        raise EmailDeliveryError("delivery_failed") from None


# ---- 套餐到期提醒（FR-SYS-012/013：续费完全线下，只提示联系销售） ----


def _reminder_texts(plan_name: str, expires_on: str, days_left: int, stage: str, language: str) -> dict:
    """en / th 文案；不编造价格与续费链接（续费靠联系销售）。"""
    thai = language == "th"
    if stage == "EXPIRED":
        if thai:
            return {
                "subject": f"แพ็กเกจ SaiFlow {plan_name} หมดอายุแล้ว",
                "heading": "แพ็กเกจของคุณหมดอายุแล้ว",
                "intro": f"แพ็กเกจ {plan_name} ของคุณหมดอายุเมื่อวันที่ {expires_on}",
                "status": "ขณะนี้ยังไม่สามารถสร้างงาน OCR ใหม่ได้ ข้อมูลและผลลัพธ์เดิมยังเปิดดูและส่งออกได้ตามปกติ",
                "action": "กรุณาติดต่อฝ่ายขาย SaiFlow เพื่อต่ออายุแพ็กเกจ",
                "link": "เปิด SaiFlow",
            }
        return {
            "subject": f"Your SaiFlow {plan_name} plan has expired",
            "heading": "Your plan has expired",
            "intro": f"Your {plan_name} plan expired on {expires_on}.",
            "status": "New OCR tasks are blocked. Existing documents and results stay available to view and export.",
            "action": "Contact SaiFlow sales to renew your plan.",
            "link": "Open SaiFlow",
        }
    if days_left == 0:
        if thai:
            return {
                "subject": f"แพ็กเกจ SaiFlow {plan_name} หมดอายุวันนี้",
                "heading": "แพ็กเกจของคุณหมดอายุวันนี้",
                "intro": f"แพ็กเกจ {plan_name} ของคุณหมดอายุวันนี้ ({expires_on})",
                "status": "หลังหมดอายุจะไม่สามารถสร้างงาน OCR ใหม่ได้",
                "action": "กรุณาติดต่อฝ่ายขาย SaiFlow เพื่อต่ออายุแพ็กเกจ",
                "link": "เปิด SaiFlow",
            }
        return {
            "subject": f"Your SaiFlow {plan_name} plan expires today",
            "heading": "Your plan expires today",
            "intro": f"Your {plan_name} plan expires today ({expires_on}).",
            "status": "Once it expires you cannot create new OCR tasks.",
            "action": "Contact SaiFlow sales to renew your plan.",
            "link": "Open SaiFlow",
        }
    if thai:
        return {
            "subject": f"แพ็กเกจ SaiFlow {plan_name} จะหมดอายุในอีก {days_left} วัน",
            "heading": f"แพ็กเกจจะหมดอายุในอีก {days_left} วัน",
            "intro": f"แพ็กเกจ {plan_name} ของคุณจะหมดอายุวันที่ {expires_on}",
            "status": f"เหลือเวลาอีก {days_left} วัน หลังหมดอายุจะไม่สามารถสร้างงาน OCR ใหม่ได้",
            "action": "กรุณาติดต่อฝ่ายขาย SaiFlow เพื่อต่ออายุแพ็กเกจ",
            "link": "เปิด SaiFlow",
        }
    unit = "day" if days_left == 1 else "days"
    return {
        "subject": f"Your SaiFlow {plan_name} plan expires in {days_left} {unit}",
        "heading": f"Your plan expires in {days_left} {unit}",
        "intro": f"Your {plan_name} plan expires on {expires_on}.",
        "status": f"{days_left} {unit} left. After it expires you cannot create new OCR tasks.",
        "action": "Contact SaiFlow sales to renew your plan.",
        "link": "Open SaiFlow",
    }


def plan_reminder_message(
    sender: str,
    recipient: str,
    *,
    plan_name: str,
    expires_on: str,
    days_left: int,
    stage: str,
    language: str = "en",
) -> EmailMessage:
    """套餐到期提醒邮件（纯文本 + HTML 两版，视觉风格与验证码邮件一致）。"""
    if stage not in ("D7", "D3", "D1", "D0", "EXPIRED"):
        raise ValueError("Unknown plan reminder stage")
    if not str(plan_name).strip() or not str(expires_on).strip():
        raise ValueError("Plan reminder requires a plan name and an expiry date")
    text = _reminder_texts(str(plan_name), str(expires_on), int(days_left), stage, language)
    # 链接可选：未配置 APP_BASE_URL 就不放链接，绝不编造地址
    base_url = str(current_app.config.get("APP_BASE_URL") or "").strip()
    link = base_url if base_url.startswith("https://") or base_url.startswith("http://") else ""

    message = EmailMessage()
    message["From"] = Address("SaiFlow", addr_spec=sender)
    message["To"] = Address(addr_spec=recipient)
    message["Subject"] = text["subject"]
    message["Date"] = formatdate(localtime=False, usegmt=True)
    message["Message-ID"] = make_msgid(domain=sender.rsplit("@", 1)[-1])
    plain = (
        f"SaiFlow\n\n{text['heading']}\n\n{text['intro']}\n\n"
        f"{text['status']}\n\n{text['action']}\n"
    )
    if link:
        plain += f"\n{text['link']}: {link}\n"
    message.set_content(plain)
    html = (
        '<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:Arial,sans-serif;color:#172033">'
        '<div style="max-width:520px;margin:32px auto;padding:32px;background:#fff;border-radius:16px">'
        '<div style="font-size:24px;font-weight:700;color:#16866a">SaiFlow</div>'
        f'<h1 style="font-size:22px;margin-top:28px">{text["heading"]}</h1><p>{text["intro"]}</p>'
        f'<div style="padding:20px;background:#eef8f4;border-radius:12px;font-size:16px;color:#16866a">'
        f'{plan_name} &middot; {expires_on}</div>'
        f'<p>{text["status"]}</p><p style="font-weight:700">{text["action"]}</p>'
    )
    if link:
        html += (
            f'<p><a href="{link}" style="color:#16866a;font-weight:700">{text["link"]}</a></p>'
        )
    html += '</div></body></html>'
    message.add_alternative(html, subtype="html")
    return message


def send_plan_reminder(
    recipient: str,
    *,
    plan_name: str,
    expires_on: str,
    days_left: int,
    stage: str,
    language: str = "en",
) -> None:
    settings = _settings()
    try:
        message = plan_reminder_message(
            settings["sender"],
            recipient,
            plan_name=plan_name,
            expires_on=expires_on,
            days_left=days_left,
            stage=stage,
            language=language,
        )
    except (ValueError, OSError):
        raise EmailDeliveryError("delivery_failed") from None
    _send(message, recipient, settings)
