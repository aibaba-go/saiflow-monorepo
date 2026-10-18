"""用户头像：图片字节存对象存储（Firebase Storage `avatars/<user_id>/<随机名>.<ext>`），DB 只存对象名。

读取经 GET /api/v1/me/avatar 后端代理（会话鉴权），不生成匿名或签名 URL。
LINE 提供的 https 头像 URL 仅作引用保存（users.avatar_url），不转存。
"""
from __future__ import annotations

import base64
import binascii
import re
import secrets

import storage

MAX_BYTES = 300 * 1024
_DATA_URL_RE = re.compile(r"^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$")
_EXT = {"png": "png", "jpeg": "jpg", "webp": "webp"}
MIME = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}


def _matches_magic(data: bytes, ext: str) -> bool:
    if ext == "png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if ext == "jpg":
        return data.startswith(b"\xff\xd8\xff")
    return data[:4] == b"RIFF" and data[8:12] == b"WEBP"


def decode_data_url(value: str) -> tuple[bytes, str] | None:
    """解析 png/jpeg/webp data URL；声明类型须与文件头一致，超限或非法返回 None。"""
    if len(value) > MAX_BYTES * 4 // 3 + 64:
        return None
    m = _DATA_URL_RE.match(value)
    if not m:
        return None
    try:
        data = base64.b64decode(m.group(2), validate=True)
    except (binascii.Error, ValueError):
        return None
    ext = _EXT[m.group(1)]
    if not data or len(data) > MAX_BYTES or not _matches_magic(data, ext):
        return None
    return data, ext


def display_url(user) -> str:
    """前端可直接用作 <img src> 的头像地址；v 随每次上传变化以绕过缓存。"""
    if user.avatar_path:
        version = user.avatar_path.rsplit("/", 1)[-1].split(".", 1)[0]
        return f"/api/v1/me/avatar?v={version}"
    return user.avatar_url


def mime_of(path: str) -> str:
    return MIME.get(path.rsplit(".", 1)[-1].lower(), "application/octet-stream")


def save_bytes(user, data: bytes, ext: str) -> str:
    """上传新头像并指向它；返回被替换的旧对象名（提交后再删）。user.id 须已分配。"""
    old = user.avatar_path
    user.avatar_path = storage.put_bytes(
        "avatars", f"{user.id}/{secrets.token_hex(8)}.{ext}", data, MIME[ext]
    )
    user.avatar_url = ""
    return old


def apply(user, value) -> str:
    """按客户端提交值更新头像（不变 / 清空 / https URL / data URL）。

    返回提交后应删除的旧对象名（无则空串）；非法值抛 ValueError，存储失败原样抛出。
    """
    value = str(value or "").strip()
    if value == display_url(user):
        return ""
    old = user.avatar_path
    if not value:
        user.avatar_url, user.avatar_path = "", ""
        return old
    if value.startswith("https://") and len(value) <= 1024:
        user.avatar_url, user.avatar_path = value, ""
        return old
    decoded = decode_data_url(value)
    if decoded is None:
        raise ValueError("invalid avatar")
    return save_bytes(user, *decoded)
