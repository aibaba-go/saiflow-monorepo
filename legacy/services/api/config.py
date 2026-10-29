"""应用配置（PRD v1.2 /api/v1 架构）。"""
import os

from urllib.parse import quote_plus

from dotenv import load_dotenv

load_dotenv()
# 本地额外密钥（DeepSeek 等），已 gitignore / gcloudignore
load_dotenv(".env.local")


def _bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, "true" if default else "false").lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


class Config:
    APP_ENV = os.getenv("APP_ENV", "production")
    SECRET_KEY = os.getenv("SECRET_KEY", "change-this-in-production")

    # ---------- PostgreSQL（Cloud SQL 18.6；ADR-001、ADR-005 回切记录） ----------
    # 库 postgres / schema saiflow；API 使用仅授权此 schema 的 saiflow_api 账号。
    # Cloud Run 配置 PGHOST=/cloudsql/... Unix 套接字；本地通过公网 TCP + TLS 连接。
    # 密码由环境变量提供，线上从 Secret Manager 注入，不在源码保存。
    PGHOST = os.getenv("PGHOST", "34.87.95.49")
    PGPORT = int(os.getenv("PGPORT", "5432"))
    PGUSER = os.getenv("PGUSER", "saiflow_api")
    PGPASSWORD = os.getenv("PGPASSWORD", "")
    PGDATABASE = os.getenv("PGDATABASE", "postgres")
    PGSCHEMA = os.getenv("PGSCHEMA", "saiflow")
    PGSSLMODE = os.getenv("PGSSLMODE", "require")

    _pg_auth = f"{quote_plus(PGUSER)}:{quote_plus(PGPASSWORD)}"
    # search_path 走连接启动参数（protocol 级，每个新物理连接都生效）：
    # 不能只用 SET SESSION 事件——Cloud SQL 服务端会重置/迁移空闲连接，事件设置的
    # search_path 在池化连接上可能丢失（实测间歇性 "relation does not exist"）。
    # 本地与 Cloud Run 共用同一实例：会话级兜底，防止任一客户端长期占锁挡住其他实例（含启动 DDL）
    # - idle_in_transaction_session_timeout：事务内空闲超 5 分钟由服务端结束会话并释放锁
    # - tcp_keepalives_*：本机断网/休眠后约 1 分钟内服务端探测到死连接并回收（Unix 套接字下自动忽略）
    # - TimeZone=UTC：模型时间均为 naive UTC；数据库会话统一为 UTC
    _pg_opts = quote_plus(
        f"-c search_path={PGSCHEMA} -c TimeZone=UTC"
        " -c idle_in_transaction_session_timeout=300000"
        " -c tcp_keepalives_idle=30 -c tcp_keepalives_interval=10 -c tcp_keepalives_count=3"
    )
    if PGHOST.startswith("/"):
        SQLALCHEMY_DATABASE_URI = (
            f"postgresql+psycopg://{_pg_auth}@/{PGDATABASE}"
            f"?host={quote_plus(PGHOST)}&options={_pg_opts}"
        )
    else:
        SQLALCHEMY_DATABASE_URI = (
            f"postgresql+psycopg://{_pg_auth}@{PGHOST}:{PGPORT}/{PGDATABASE}"
            f"?sslmode={quote_plus(PGSSLMODE)}&options={_pg_opts}"
            "&keepalives=1&keepalives_idle=30&keepalives_interval=10&keepalives_count=3"
        )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # 让 jsonify 直接输出 UTF-8 中文，而非 \uXXXX 转义
    JSON_ENSURE_ASCII = False

    # ---------- 会话（PRD §4.2：HttpOnly Cookie + CSRF） ----------
    SESSION_COOKIE_NAME = "saiflow_session"
    # 绝对过期：30 天；空闲过期：12 小时
    SESSION_ABSOLUTE_TTL_SECONDS = 30 * 24 * 3600
    SESSION_IDLE_TTL_SECONDS = 12 * 3600
    # Secure cookie 仅经 env 开启（本地 http 开发置 false；生产必须 true）
    SESSION_COOKIE_SECURE = _bool("SESSION_COOKIE_SECURE", False)
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_PATH = "/api"
    CSRF_HEADER_NAME = "X-CSRF-Token"

    # ---------- LINE 登录 ----------
    # LINE 登录
    LINE_CHANNEL_ID = os.getenv("LINE_CHANNEL_ID", "")
    # FR-SYS-001/014/016：本地开发须显式启用；Cloud Run 即使误配也禁止绕过。
    AUTH_DEV_MODE = (
        APP_ENV == "development"
        and os.getenv("AUTH_DEV_MODE", "false").lower() == "true"
        and "K_SERVICE" not in os.environ
    )

    # ---------- 邮箱验证码（FR-SYS-014/016） ----------
    # 生产密码仅通过 Secret Manager 注入；Gmail 使用应用专用密码，不是网页登录密码。
    MAIL_SMTP_HOST = os.getenv("MAIL_SMTP_HOST", "")
    MAIL_SMTP_PORT = int(os.getenv("MAIL_SMTP_PORT", "465"))
    MAIL_SMTP_SECURITY = os.getenv("MAIL_SMTP_SECURITY", "ssl")
    MAIL_SMTP_USERNAME = os.getenv("MAIL_SMTP_USERNAME", "")
    MAIL_SMTP_PASSWORD = os.getenv("MAIL_SMTP_PASSWORD", "")
    MAIL_FROM = os.getenv("MAIL_FROM", MAIL_SMTP_USERNAME)
    MAIL_SMTP_TIMEOUT_SECONDS = float(os.getenv("MAIL_SMTP_TIMEOUT_SECONDS", "10"))

    # ---------- 套餐到期提醒（FR-SYS-012/013） ----------
    # worker 每 30 分钟检查一次「今天是否已跑过」，真正的唯一性由
    # plan_reminders 唯一约束保证（本地与 Cloud Run 共用一个库，可能多实例并行）。
    PLAN_REMINDERS_ENABLED = _bool("PLAN_REMINDERS_ENABLED", True)
    # 提醒邮件里的「打开 SaiFlow」链接；留空则邮件中不放任何链接（不编造地址）
    APP_BASE_URL = os.getenv("APP_BASE_URL", "")

    # ---------- 上传与任务限额（PRD §11） ----------
    # 对象存储后端（storage.py）：local=本地盘（开发/测试），firebase=Firebase Storage（生产）
    STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local")
    GOOGLE_CLOUD_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "saiflow-509205")
    FIREBASE_STORAGE_BUCKET = os.getenv(
        "FIREBASE_STORAGE_BUCKET", "saiflow-509205.firebasestorage.app"
    )
    FILE_STORAGE_DIR = os.getenv("FILE_STORAGE_DIR", "./storage/files")
    EXPORT_STORAGE_DIR = os.getenv("EXPORT_STORAGE_DIR", "./storage/exports")
    ALLOWED_FILE_EXTENSIONS = {"jpg", "jpeg", "png", "pdf"}
    ALLOWED_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png"}
    MAX_CONTENT_LENGTH = 20 * 1024 * 1024  # 单文件 20MB（上传 content 走 PUT 流，仅兜底）
    MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024  # 单文件 20MB
    MAX_IMAGES_PER_TASK = 10
    MAX_PAGES_PER_TASK = 50
    MAX_IMAGES_TOTAL_BYTES = 50 * 1024 * 1024  # 图片合计 50MB
    UPLOAD_SESSION_TTL_SECONDS = 24 * 3600

    # ---------- TextIn OCR provider（唯一厂商，PRD §12） ----------
    TEXTIN_APP_ID = os.getenv("TEXTIN_APP_ID", "b3e32c671acc4e3e06bf7decf3ac34f3")
    TEXTIN_SECRET_CODE = os.getenv("TEXTIN_SECRET_CODE", "19c4b48830795b42b7c0e1b421419ccf")
    TEXTIN_ENDPOINT = os.getenv(
        "TEXTIN_ENDPOINT", "https://api.textin.ai/api/v1/xparse/parse/sync"
    )
    TEXTIN_EXTRACT_ENDPOINT = os.getenv(
        "TEXTIN_EXTRACT_ENDPOINT", "https://api.textin.ai/api/v1/xparse/extract/sync"
    )
    OCR_STORAGE_DIR = os.getenv("OCR_STORAGE_DIR", "./temp/extractions")
    TEXTIN_TIMEOUT_SECONDS = float(os.getenv("TEXTIN_TIMEOUT_SECONDS", "120"))
    TEXTIN_CONNECT_TIMEOUT_SECONDS = float(os.getenv("TEXTIN_CONNECT_TIMEOUT_SECONDS", "10"))

    # ---------- DeepSeek：二次整理 TextIn JSON（未配置 key 则跳过，直接用 TextIn 结果） ----------
    DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
    DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-flash")
    DEEPSEEK_TIMEOUT_SECONDS = float(os.getenv("DEEPSEEK_TIMEOUT_SECONDS", "120"))
