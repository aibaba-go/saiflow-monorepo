"""核心数据模型（PRD §13 的 P0 落地）。

覆盖：users / sessions / enterprises / memberships / applications /
invitations / files（含 upload_sessions 生命周期）/ ocr_jobs /
result_versions / page_results / exports / notifications / audit_events /
data_requests / review_sync_cursors。
大型结果 JSON 存 page_results.tables/text/fields（PostgreSQL JSON 列），
原件字节存私有存储目录，库中只保存引用与索引。
表/字段说明写在 comment=，是数据库 COMMENT 的唯一来源。
"""
from __future__ import annotations

import uuid

from datetime import datetime, timezone

import avatars
from extensions import db


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _bigint_pk():
    """PostgreSQL 用 BIGINT IDENTITY 自增；SQLite 退化为 INTEGER 才能自增。"""
    return db.BigInteger().with_variant(db.Integer, "sqlite")


class TimestampMixin:
    created_at = db.Column(db.DateTime, nullable=False, default=_now, comment="创建时间（UTC）")
    updated_at = db.Column(
        db.DateTime, nullable=False, default=_now, onupdate=_now, comment="最后更新时间（UTC）"
    )


# ---------- 身份与会话 ----------


class User(db.Model, TimestampMixin):
    __tablename__ = "users"

    id = db.Column(_bigint_pk(), primary_key=True, autoincrement=True, comment="用户 ID（自增主键）")
    line_provider = db.Column(
        db.String(32), nullable=False, default="line",
        comment="身份来源：line=LINE 正式账号（含开发调试登录 dev:<id>）/ guest=游客试用",
    )
    line_sub = db.Column(
        db.String(128), nullable=False, comment="身份来源内的唯一标识（LINE userId / 游客随机 ID）"
    )
    display_name = db.Column(db.String(128), nullable=False, default="", comment="显示名称")
    avatar_url = db.Column(
        db.Text, nullable=False, default="", comment="外部头像 URL（仅 https，来自 LINE 资料）"
    )
    avatar_path = db.Column(
        db.String(255), nullable=False, default="",
        comment="用户自行上传头像在对象存储中的对象名；非空时优先于 avatar_url",
    )
    language = db.Column(db.String(8), nullable=False, default="th", comment="界面语言：th / en")
    status = db.Column(
        db.String(16), nullable=False, default="ACTIVE", comment="账号状态：ACTIVE=正常 / DISABLED=禁用"
    )
    phone = db.Column(
        db.String(32), nullable=False, default="", comment="手机号（来自 LINE，用户不可修改）"
    )
    email = db.Column(db.String(254), nullable=False, default="", comment="已验证的邮箱")
    registered_at = db.Column(
        db.DateTime, nullable=True, comment="完成注册信息录入的时间；NULL=尚未完成注册"
    )

    __table_args__ = (
        db.UniqueConstraint("line_provider", "line_sub", name="uq_users_line_identity"),
        {"comment": "用户账号（LINE 正式用户与游客）"},
    )

    @property
    def is_guest(self) -> bool:
        return self.line_provider == "guest"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "display_name": self.display_name,
            "avatar_url": avatars.display_url(self),
            "language": self.language,
            "status": self.status,
            "is_guest": self.is_guest,
            "phone": self.phone,
            "email": self.email,
            "registered": self.registered_at is not None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class EmailVerificationCode(db.Model):
    __tablename__ = "email_verification_codes"
    __table_args__ = {"comment": "邮箱验证码（绑定/修改邮箱时发送，库中仅存哈希）"}

    id = db.Column(_bigint_pk(), primary_key=True, autoincrement=True, comment="主键")
    user_id = db.Column(
        db.BigInteger, db.ForeignKey("users.id"), nullable=False, index=True, comment="申请验证的用户 → users.id"
    )
    email = db.Column(db.String(254), nullable=False, comment="待验证的邮箱地址")
    code_hash = db.Column(db.String(64), nullable=False, comment="验证码的 SHA-256 哈希（不存明文）")
    expires_at = db.Column(db.DateTime, nullable=False, comment="过期时间（UTC）")
    consumed_at = db.Column(db.DateTime, nullable=True, comment="验证码被成功使用的时间；NULL=未使用")
    created_at = db.Column(db.DateTime, nullable=False, default=_now, comment="发送时间（UTC）")


class Session(db.Model):
    __tablename__ = "sessions"
    __table_args__ = {"comment": "登录会话（HttpOnly Cookie saiflow_session 对应的服务端记录）"}

    id = db.Column(_bigint_pk(), primary_key=True, autoincrement=True, comment="主键")
    token_hash = db.Column(
        db.String(64), nullable=False, unique=True, comment="会话令牌的 SHA-256 哈希（Cookie 中为明文令牌）"
    )
    user_id = db.Column(
        db.BigInteger, db.ForeignKey("users.id"), nullable=False, index=True, comment="会话所属用户 → users.id"
    )
    csrf_hash = db.Column(db.String(64), nullable=False, comment="CSRF 令牌的 SHA-256 哈希（校验 X-CSRF-Token）")
    issued_at = db.Column(db.DateTime, nullable=False, default=_now, comment="签发时间（UTC）")
    absolute_expires_at = db.Column(db.DateTime, nullable=False, comment="绝对过期时间（UTC），到期必须重新登录")
    idle_expires_at = db.Column(db.DateTime, nullable=False, comment="空闲过期时间（UTC），每次访问顺延")
    revoked_at = db.Column(db.DateTime, nullable=True, comment="主动注销/吊销时间；NULL=未吊销")
    created_ip = db.Column(db.String(64), nullable=False, default="", comment="创建会话时的客户端 IP")

    @property
    def is_revoked(self) -> bool:
        return self.revoked_at is not None

    def is_expired(self, now: datetime | None = None) -> bool:
        now = now or _now()
        return now >= self.absolute_expires_at or now >= self.idle_expires_at

    def touch(self, idle_ttl_seconds: int) -> None:
        from datetime import timedelta

        self.idle_expires_at = _now() + timedelta(seconds=idle_ttl_seconds)


# ---------- 企业与成员 ----------


class Enterprise(db.Model, TimestampMixin):
    __tablename__ = "enterprises"
    __table_args__ = {"comment": "企业（企业工作空间主体）"}

    id = db.Column(_bigint_pk(), primary_key=True, autoincrement=True, comment="企业 ID（自增主键）")
    code = db.Column(
        db.String(32), nullable=False, unique=True, comment="企业编号（形如 ent-yymmdd-xxxxxx），成员凭此绑定企业"
    )
    country = db.Column(db.String(8), nullable=False, default="TH", comment="国家/地区代码，默认 TH")
    legal_name = db.Column(db.String(255), nullable=False, default="", comment="企业法定名称")
    registration_no = db.Column(db.String(64), nullable=False, default="", comment="工商/税务登记号")
    contact_phone = db.Column(db.String(32), nullable=False, default="", comment="企业联系电话")
    cert_file_id = db.Column(
        db.String(36), db.ForeignKey("files.id"), nullable=True, comment="营业执照等认证材料文件 → files.id"
    )
    status = db.Column(
        db.String(32), nullable=False, default="PENDING_VERIFICATION",
        comment="企业状态：PENDING_VERIFICATION=待认证 / VERIFIED=已认证 / SUSPENDED=暂停 / DISABLED=停用",
    )
    external_ref = db.Column(db.String(64), nullable=False, default="", comment="外部系统引用号（预留）")
    policy_version = db.Column(db.Integer, nullable=False, default=1, comment="企业策略版本号（预留）")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "code": self.code,
            "country": self.country,
            "legal_name": self.legal_name,
            "registration_no": self.registration_no,
            "contact_phone": self.contact_phone,
            "cert_file_id": self.cert_file_id,
            "status": self.status,
        }


class Membership(db.Model, TimestampMixin):
    __tablename__ = "memberships"
    __table_args__ = (
        db.UniqueConstraint("enterprise_id", "user_id", name="uq_membership_enterprise_user"),
        {"comment": "企业成员关系（用户 × 企业，唯一）"},
    )

    id = db.Column(_bigint_pk(), primary_key=True, autoincrement=True, comment="主键")
    enterprise_id = db.Column(
        db.BigInteger, db.ForeignKey("enterprises.id"), nullable=False, comment="所属企业 → enterprises.id"
    )
    user_id = db.Column(
        db.BigInteger, db.ForeignKey("users.id"), nullable=False, index=True, comment="成员用户 → users.id"
    )
    role = db.Column(
        db.String(16), nullable=False, default="MEMBER", comment="成员角色：OWNER=所有者 / ADMIN=管理员 / MEMBER=普通成员"
    )
    status = db.Column(
        db.String(16), nullable=False, default="PENDING",
        comment="成员状态：PENDING=待审批 / ACTIVE=有效 / REJECTED=已拒绝 / REMOVED=被移除 / LEFT=已退出",
    )
    approved_via = db.Column(
        db.String(32), nullable=False, default="",
        comment="加入方式：CREATE=创建企业 / BIND=企业编号绑定 / APPLICATION=入企申请 / INVITATION=邀请",
    )
    decided_at = db.Column(db.DateTime, nullable=True, comment="审批通过/拒绝的时间")
    revoked_at = db.Column(db.DateTime, nullable=True, comment="移除/退出（解绑）的时间")


# ---------- 申请与邀请 ----------


class Application(db.Model, TimestampMixin):
    __tablename__ = "applications"
    __table_args__ = {"comment": "申请单（企业认证 / 入企 / 套餐升级）"}

    id = db.Column(_bigint_pk(), primary_key=True, autoincrement=True, comment="申请 ID（自增主键）")
    type = db.Column(
        db.String(32), nullable=False,
        comment="申请类型：ENTERPRISE_VERIFICATION=企业认证 / MEMBERSHIP=入企 / PLAN_UPGRADE=套餐升级",
    )
    applicant_user_id = db.Column(
        db.BigInteger, db.ForeignKey("users.id"), nullable=False, index=True, comment="申请人 → users.id"
    )
    target_enterprise_id = db.Column(
        db.BigInteger, db.ForeignKey("enterprises.id"), nullable=True, comment="目标企业 → enterprises.id"
    )
    form = db.Column(
        db.JSON, nullable=False,
        comment="表单快照 JSON（企业：legal_name/country/registration_no/contact…；入企：message…）",
    )
    status = db.Column(
        db.String(24), nullable=False, default="DRAFT",
        comment="申请状态：DRAFT/SUBMITTED/UNDER_REVIEW/NEEDS_INFO/APPROVED/REJECTED/WITHDRAWN"
                "（套餐升级 APPROVED=套餐已开通）",
    )
    version = db.Column(db.Integer, nullable=False, default=1, comment="版本号（乐观并发控制）")
    review_note = db.Column(db.String(512), nullable=False, default="", comment="审核意见")
    submitted_at = db.Column(db.DateTime, nullable=True, comment="提交时间；NULL=草稿未提交")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "type": self.type,
            "status": self.status,
            "form": self.form,
            "version": self.version,
            "review_note": self.review_note,
            "target_enterprise_id": self.target_enterprise_id,
            "submitted_at": self.submitted_at.isoformat() if self.submitted_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class Invitation(db.Model, TimestampMixin):
    __tablename__ = "invitations"
    __table_args__ = {"comment": "企业邀请（邀请令牌，库中仅存哈希）"}

    id = db.Column(_bigint_pk(), primary_key=True, autoincrement=True, comment="邀请 ID（自增主键）")
    token_hash = db.Column(db.String(64), nullable=False, unique=True, comment="邀请令牌的 SHA-256 哈希")
    enterprise_id = db.Column(
        db.BigInteger, db.ForeignKey("enterprises.id"), nullable=False, comment="邀请加入的企业 → enterprises.id"
    )
    created_by_user_id = db.Column(
        db.BigInteger, db.ForeignKey("users.id"), nullable=False, comment="邀请创建人 → users.id"
    )
    max_uses = db.Column(db.Integer, nullable=False, default=1, comment="最多可使用次数")
    use_count = db.Column(db.Integer, nullable=False, default=0, comment="已使用次数")
    expires_at = db.Column(db.DateTime, nullable=False, comment="过期时间（UTC）")
    status = db.Column(
        db.String(16), nullable=False, default="ACTIVE", comment="邀请状态：ACTIVE=有效 / REVOKED=已撤销 / EXPIRED=已过期"
    )


# ---------- 文件（含上传会话生命周期） ----------


class File(db.Model, TimestampMixin):
    __tablename__ = "files"
    __table_args__ = {"comment": "上传文件（含上传会话生命周期；原件字节存私有对象存储）"}

    id = db.Column(db.String(36), primary_key=True, default=_uuid, comment="文件 ID（UUID hex），兼作上传会话 ID")
    workspace_type = db.Column(
        db.String(16), nullable=False, default="PERSONAL", comment="所属工作空间类型：PERSONAL=个人 / ENTERPRISE=企业"
    )
    enterprise_id = db.Column(
        db.BigInteger, db.ForeignKey("enterprises.id"), nullable=True, comment="企业空间时的企业 → enterprises.id"
    )
    created_by_user_id = db.Column(
        db.BigInteger, db.ForeignKey("users.id"), nullable=False, index=True, comment="创建人 → users.id"
    )
    uploader_user_id = db.Column(
        db.BigInteger, db.ForeignKey("users.id"), nullable=False, comment="实际上传人 → users.id"
    )
    purpose = db.Column(
        db.String(32), nullable=False, default="OCR_TASK",
        comment="用途：OCR_TASK=OCR 识别原件 / APPLICATION_MATERIAL=申请材料",
    )
    original_name = db.Column(db.String(255), nullable=False, default="", comment="原始文件名")
    storage_path = db.Column(db.String(512), nullable=False, default="", comment="对象存储中的对象路径")
    mime_type = db.Column(db.String(128), nullable=False, default="", comment="MIME 类型")
    size_bytes = db.Column(db.BigInteger, nullable=False, default=0, comment="文件大小（字节）")
    page_count = db.Column(db.Integer, nullable=False, default=0, comment="页数（PDF 解析得出，图片为 1）")
    sha256 = db.Column(db.String(64), nullable=False, default="", comment="文件内容 SHA-256")
    status = db.Column(
        db.String(16), nullable=False, default="UPLOADING",
        comment="文件状态：UPLOADING=上传中 / UPLOADED=已上传 / VALIDATING=校验中 / READY=可用 / REJECTED=被拒绝",
    )
    reject_reason = db.Column(db.String(255), nullable=False, default="", comment="被拒绝原因（消息键）")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "workspace_type": self.workspace_type,
            "enterprise_id": self.enterprise_id,
            "purpose": self.purpose,
            "original_name": self.original_name,
            "mime_type": self.mime_type,
            "size_bytes": self.size_bytes,
            "page_count": self.page_count,
            "sha256": self.sha256,
            "status": self.status,
            "reject_reason": self.reject_reason,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


# ---------- OCR 任务 ----------


class OcrJob(db.Model, TimestampMixin):
    __tablename__ = "ocr_jobs"
    __table_args__ = {"comment": "OCR 识别任务（自有队列表，由进程内 worker 轮询驱动）"}

    id = db.Column(db.String(36), primary_key=True, default=_uuid, comment="任务 ID（UUID hex）")
    workspace_type = db.Column(
        db.String(16), nullable=False, default="PERSONAL", comment="所属工作空间类型：PERSONAL=个人 / ENTERPRISE=企业"
    )
    enterprise_id = db.Column(
        db.BigInteger, db.ForeignKey("enterprises.id"), nullable=True, comment="企业空间时的企业 → enterprises.id"
    )
    created_by_user_id = db.Column(
        db.BigInteger, db.ForeignKey("users.id"), nullable=False, index=True, comment="创建人 → users.id"
    )
    file_id = db.Column(db.String(36), db.ForeignKey("files.id"), nullable=False, comment="识别的原件 → files.id")
    params = db.Column(
        db.JSON, nullable=False, default=dict, comment="任务参数 JSON（起始页 page、页数 page_count、字段 field_names 等）"
    )
    capability = db.Column(db.JSON, nullable=False, default=dict, comment="创建时的 TextIn 能力快照 JSON")
    status = db.Column(
        db.String(24), nullable=False, default="QUEUED", index=True,
        comment="任务状态：QUEUED/PREPROCESSING/PROCESSING/POSTPROCESSING/SUCCEEDED/PARTIAL_SUCCESS/"
                "FAILED/CANCEL_REQUESTED/CANCELLED",
    )
    idempotency_key = db.Column(
        db.String(128), nullable=True, unique=True, comment="创建请求的幂等键（防重复提交）"
    )
    parent_job_id = db.Column(db.String(36), nullable=True, comment="重新识别（rerun）时的来源任务 ID")
    progress = db.Column(db.Integer, nullable=False, default=0, comment="进度百分比 0-100")
    error_code = db.Column(db.String(64), nullable=False, default="", comment="失败错误码")
    error_message = db.Column(db.String(512), nullable=False, default="", comment="失败错误信息")
    vendor_request_id = db.Column(db.String(64), nullable=False, default="", comment="TextIn 请求 ID（排障用）")
    vendor_task_id = db.Column(
        db.String(64), nullable=True, comment="DocFlow file-level task_id（vendor 返回；排障 + 重试用）"
    )
    vendor_batch_number = db.Column(
        db.String(64), nullable=True, comment="DocFlow file-level batch_number（vendor 返回）"
    )
    vendor_category = db.Column(
        db.String(64), nullable=True, comment="DocFlow file-level category（vendor 分类结果）"
    )
    recognition_status = db.Column(
        db.Integer, nullable=True,
        comment="DocFlow 文件级 recognition_status（0/1/2/...）；持久化以便 audit",
    )
    page_count = db.Column(db.Integer, nullable=False, default=0, comment="识别页数")
    table_count = db.Column(db.Integer, nullable=False, default=0, comment="识别出的表格数")
    field_count = db.Column(db.Integer, nullable=False, default=0, comment="识别出的字段数")
    duration_ms = db.Column(db.BigInteger, nullable=False, default=0, comment="识别耗时（毫秒）")
    missing_pages = db.Column(db.JSON, nullable=True, comment="PARTIAL_SUCCESS 时未识别成功的页码 JSON 数组")
    review_status = db.Column(
        db.String(16), nullable=False, default="UNREVIEWED",
        comment="核验状态：UNREVIEWED=未核验 / EDITED=已修改 / CONFIRMED=已确认",
    )
    started_at = db.Column(db.DateTime, nullable=True, comment="开始处理时间")
    finished_at = db.Column(db.DateTime, nullable=True, comment="识别结束（成功/失败/取消）时间")
    completed_at = db.Column(
        db.DateTime, nullable=True,
        comment="已注册用户确认结果的时间（最终完成）；游客/未注册用户确认后为空（数据已验证）",
    )

    def stage(self) -> str:
        """流程阶段：OCR 处理中/失败 → 数据验证中 → 数据已验证（未注册时确认）/ 最终完成。"""
        if self.status in ("FAILED", "CANCELLED"):
            return "OCR_FAILED"
        if self.status not in ("SUCCEEDED", "PARTIAL_SUCCESS"):
            return "OCR_PROCESSING"
        if self.review_status != "CONFIRMED":
            return "VERIFYING"
        return "COMPLETED" if self.completed_at else "VERIFIED"

    def to_summary(self, file_name: str = "") -> dict:
        return {
            "id": self.id,
            "workspace_type": self.workspace_type,
            "enterprise_id": self.enterprise_id,
            "file_id": self.file_id,
            "file_name": file_name,
            "status": self.status,
            "progress": self.progress,
            "page_count": self.page_count,
            "table_count": self.table_count,
            "field_count": self.field_count,
            "duration_ms": self.duration_ms,
            "review_status": self.review_status,
            "stage": self.stage(),
            "error_code": self.error_code,
            "error_message": self.error_message,
            "parent_job_id": self.parent_job_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "task_id": self.vendor_task_id,
            "batch_number": self.vendor_batch_number,
            "category": self.vendor_category,
            "recognition_status": self.recognition_status,
        }


# ---------- 结果版本与页结果 ----------


class ResultVersion(db.Model):
    __tablename__ = "result_versions"
    __table_args__ = (
        db.UniqueConstraint("job_id", "version", name="uq_result_version_job_version"),
        {"comment": "识别结果版本（OCR 原始结果为 v1，每次人工修改保存生成新版本）"},
    )

    id = db.Column(db.String(36), primary_key=True, default=_uuid, comment="结果版本 ID（UUID hex）")
    job_id = db.Column(
        db.String(36), db.ForeignKey("ocr_jobs.id"), nullable=False, index=True, comment="所属任务 → ocr_jobs.id"
    )
    version = db.Column(db.Integer, nullable=False, default=1, comment="版本号（任务内从 1 递增）")
    is_current = db.Column(db.Boolean, nullable=False, default=True, comment="是否为当前生效版本")
    created_by_user_id = db.Column(
        db.BigInteger, db.ForeignKey("users.id"), nullable=True, comment="保存该版本的用户 → users.id；OCR 生成为 NULL"
    )
    created_at = db.Column(db.DateTime, nullable=False, default=_now, comment="创建时间（UTC）")
    structured = db.Column(
        db.JSON, nullable=True, comment="TextIn Prompt 模式返回的结构化 JSON（字段 + 表格）；旧版逐页结果为 NULL"
    )


class PageResult(db.Model):
    __tablename__ = "page_results"
    __table_args__ = (
        db.UniqueConstraint("result_version_id", "page_number", name="uq_page_result_version_page"),
        {"comment": "逐页识别结果（文本 / 表格 / 字段）"},
    )

    id = db.Column(db.String(36), primary_key=True, default=_uuid, comment="主键（UUID hex）")
    result_version_id = db.Column(
        db.String(36), db.ForeignKey("result_versions.id"), nullable=False, index=True,
        comment="所属结果版本 → result_versions.id",
    )
    page_number = db.Column(db.Integer, nullable=False, comment="原始页码（从 1 开始）")
    text = db.Column(db.Text, nullable=False, default="", comment="整页识别文本")
    tables = db.Column(
        db.JSON, nullable=False, default=list,
        comment="表格 JSON：[{table_id,row_count,column_count,cells:[{row_index,column_index,row_span,"
                "column_span,raw_text,current_text,polygon,confidence,review_status}]}]",
    )
    fields = db.Column(
        db.JSON, nullable=False, default=list, comment="字段 JSON：[{name,value,source,source_page}]"
    )


# ---------- 导出 ----------


class Export(db.Model, TimestampMixin):
    __tablename__ = "exports"
    __table_args__ = {"comment": "结果导出文件（XLSX/CSV/TXT，限时下载）"}

    id = db.Column(db.String(36), primary_key=True, default=_uuid, comment="导出 ID（UUID hex）")
    job_id = db.Column(
        db.String(36), db.ForeignKey("ocr_jobs.id"), nullable=False, index=True, comment="所属任务 → ocr_jobs.id"
    )
    result_version_id = db.Column(
        db.String(36), db.ForeignKey("result_versions.id"), nullable=False,
        comment="导出所基于的结果版本 → result_versions.id",
    )
    format = db.Column(db.String(8), nullable=False, comment="导出格式：XLSX / CSV / TXT")
    status = db.Column(
        db.String(16), nullable=False, default="GENERATING",
        comment="导出状态：GENERATING=生成中 / READY=可下载 / EXPIRED=已过期 / FAILED=失败",
    )
    storage_path = db.Column(db.String(512), nullable=False, default="", comment="导出文件在对象存储中的路径")
    expires_at = db.Column(db.DateTime, nullable=True, comment="下载过期时间（UTC）")
    created_by_user_id = db.Column(
        db.BigInteger, db.ForeignKey("users.id"), nullable=False, comment="发起导出的用户 → users.id"
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "job_id": self.job_id,
            "result_version_id": self.result_version_id,
            "format": self.format,
            "status": self.status,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


# ---------- 通知 / 审计 / 数据请求 / 外部审核游标 ----------


class Notification(db.Model):
    __tablename__ = "notifications"
    __table_args__ = {"comment": "站内通知"}

    id = db.Column(_bigint_pk(), primary_key=True, autoincrement=True, comment="主键")
    user_id = db.Column(
        db.BigInteger, db.ForeignKey("users.id"), nullable=False, index=True, comment="接收用户 → users.id"
    )
    type = db.Column(db.String(32), nullable=False, default="INFO", comment="通知类型，默认 INFO")
    title = db.Column(db.String(128), nullable=False, default="", comment="标题")
    body = db.Column(db.String(512), nullable=False, default="", comment="正文")
    read_at = db.Column(db.DateTime, nullable=True, comment="已读时间；NULL=未读")
    created_at = db.Column(db.DateTime, nullable=False, default=_now, comment="创建时间（UTC）")


class AuditEvent(db.Model):
    __tablename__ = "audit_events"
    __table_args__ = {"comment": "审计事件 / 用户操作记录"}

    id = db.Column(_bigint_pk(), primary_key=True, autoincrement=True, comment="主键")
    user_id = db.Column(
        db.BigInteger, db.ForeignKey("users.id"), nullable=False, index=True, comment="操作用户 → users.id"
    )
    action = db.Column(db.String(64), nullable=False, comment="操作动作（如 user.register）")
    object_type = db.Column(db.String(32), nullable=False, default="", comment="操作对象类型")
    object_id = db.Column(db.String(64), nullable=False, default="", comment="操作对象 ID")
    detail = db.Column(db.JSON, nullable=False, default=dict, comment="附加详情 JSON")
    created_at = db.Column(db.DateTime, nullable=False, default=_now, comment="发生时间（UTC）")


class DataRequest(db.Model):
    __tablename__ = "data_requests"
    __table_args__ = {"comment": "PDPA 个人数据请求（查阅 / 删除）"}

    id = db.Column(_bigint_pk(), primary_key=True, autoincrement=True, comment="主键")
    user_id = db.Column(
        db.BigInteger, db.ForeignKey("users.id"), nullable=False, index=True, comment="提出请求的用户 → users.id"
    )
    kind = db.Column(db.String(16), nullable=False, comment="请求类型：ACCESS=查阅 / DELETION=删除")
    status = db.Column(
        db.String(16), nullable=False, default="PENDING", comment="处理状态：PENDING=待处理 / DONE=已完成 / REJECTED=已拒绝"
    )
    note = db.Column(db.String(255), nullable=False, default="", comment="用户备注")
    created_at = db.Column(db.DateTime, nullable=False, default=_now, comment="提交时间（UTC）")
    processed_at = db.Column(db.DateTime, nullable=True, comment="处理完成时间")


class ReviewSyncCursor(db.Model):
    """外部审核主动拉取的幂等游标（接口冻结前仅保留结构）。"""

    __tablename__ = "review_sync_cursors"
    __table_args__ = {"comment": "外部审核主动拉取的幂等游标（接口冻结前仅保留结构）"}

    id = db.Column(_bigint_pk(), primary_key=True, autoincrement=True, comment="主键")
    source = db.Column(db.String(32), nullable=False, unique=True, comment="数据来源标识（唯一）")
    cursor = db.Column(db.String(128), nullable=False, default="", comment="最近一次拉取到的游标位置")
    updated_at = db.Column(db.DateTime, nullable=False, default=_now, comment="游标更新时间（UTC）")


# ---------- 配额流水（PRD v1.4 §20） ----------


class QuotaLedger(db.Model):
    """赠送/消耗/返还统一记账：工作空间余额 = SUM(quantity)。

    个人空间键 = (PERSONAL, user_id)；企业空间键 = (ENTERPRISE, enterprise_id)。
    grant_key 唯一约束保证发放幂等（首登赠 / 企业认证赠）；消耗与返还按
    job_id 关联，返还以「已有 CONSUME 且无 REFUND」幂等防重。
    """

    __tablename__ = "quota_ledger"
    __table_args__ = {"comment": "配额流水（赠送/消耗/返还统一记账，工作空间余额 = SUM(quantity)）"}

    id = db.Column(_bigint_pk(), primary_key=True, autoincrement=True, comment="主键")
    grant_key = db.Column(
        db.String(128), nullable=True, unique=True, comment="发放幂等键（首登赠 / 企业认证赠），消耗与返还为 NULL"
    )
    workspace_type = db.Column(db.String(16), nullable=False, comment="工作空间类型：PERSONAL=个人 / ENTERPRISE=企业")
    enterprise_id = db.Column(db.BigInteger, nullable=True, comment="企业空间的企业 ID（企业空间余额键）")
    user_id = db.Column(db.BigInteger, nullable=True, index=True, comment="个人空间的用户 ID（个人空间余额键）")
    entry_type = db.Column(db.String(16), nullable=False, comment="流水类型：GRANT=发放 / CONSUME=消耗 / REFUND=返还")
    benefit_code = db.Column(
        db.String(32), nullable=False,
        comment="权益代码：FIRST_LOGIN=首次登录赠送 / FIRST_ENTERPRISE_VERIFIED=企业首次认证赠送 / OCR_TASK=OCR 任务",
    )
    quantity = db.Column(db.Integer, nullable=False, comment="数量：发放/返还为正，消耗为负")
    job_id = db.Column(db.String(36), nullable=True, index=True, comment="关联的 OCR 任务 ID（消耗/返还）")
    created_at = db.Column(db.DateTime, nullable=False, default=_now, comment="记账时间（UTC）")
