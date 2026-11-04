"""核心数据模型（PRD §13 的 P0 落地）。

覆盖：users / sessions / tenants / enterprises / memberships / applications /
invitations / files（含 upload_sessions 生命周期）/ ocr_jobs /
result_versions / page_results / exports / subscriptions / plan_reminders / plans /
notifications / audit_events / data_requests / review_sync_cursors /
document_templates / document_template_versions / ocr_raw_results / template_mappings。
大型结果 JSON 存 page_results.tables/text/fields（PostgreSQL JSON 列），
原件字节存私有存储目录，库中只保存引用与索引。
表/字段说明写在 comment=，是数据库 COMMENT 的唯一来源。

归属统一走 tenants：个人用户与企业各占一个租户，业务表只带 tenant_id，
不再出现 workspace_type/enterprise_id 这种双列归属（避免两套口径互相漂移）。
"""
from __future__ import annotations

import uuid

from datetime import datetime, timezone

from sqlalchemy import func, text

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
        db.String(32), nullable=False, default="", comment="手机号（默认 LINE 返回值，注册时可编辑；个人中心可修改）"
    )
    email = db.Column(db.String(254), nullable=False, default="", comment="邮箱（注册前可为 LINE 默认值，注册后已验证）")
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


# ---------- 租户（统一归属主体） ----------


class Tenant(db.Model, TimestampMixin):
    """个人用户与企业用户的统一归属主体；业务表只通过 tenant_id 关联。

    个人租户与 user 严格 1:1（owner_user_id 唯一，含游客）；企业租户与
    enterprise 1:1（owner_user_id 为 NULL，专有字段留在 enterprises）。
    status 只表达「这个租户还能不能用」，企业的审核语义仍在 enterprises.status。
    """

    __tablename__ = "tenants"
    __table_args__ = (
        # 个人租户与 user 严格 1:1；企业租户 owner_user_id 为 NULL，
        # PostgreSQL 唯一约束不约束 NULL，因此企业租户不受影响。
        db.UniqueConstraint("owner_user_id", name="uq_tenants_owner_user"),
        {"comment": "租户（个人用户与企业用户的统一归属主体，业务表按 tenant_id 归属）"},
    )

    id = db.Column(_bigint_pk(), primary_key=True, autoincrement=True, comment="租户 ID（自增主键）")
    tenant_type = db.Column(
        db.String(16), nullable=False,
        comment="租户类型：PERSONAL=个人租户（含游客） / ENTERPRISE=企业租户",
    )
    owner_user_id = db.Column(
        db.BigInteger, db.ForeignKey("users.id"), nullable=True,
        comment="个人租户的所属用户 → users.id（唯一，保证 1:1）；企业租户为 NULL",
    )
    display_name = db.Column(
        db.String(255), nullable=False, default="",
        comment="租户显示名称（个人=用户昵称快照 / 企业=企业法定名称）",
    )
    status = db.Column(
        db.String(16), nullable=False, default="ACTIVE",
        comment="租户可用性：ACTIVE=可用 / SUSPENDED=暂停 / DISABLED=停用（企业审核状态见 enterprises.status）",
    )


# ---------- 企业与成员 ----------


class Enterprise(db.Model, TimestampMixin):
    __tablename__ = "enterprises"
    __table_args__ = {"comment": "企业（企业租户的专有信息；共性信息在 tenants）"}

    id = db.Column(_bigint_pk(), primary_key=True, autoincrement=True, comment="企业 ID（自增主键）")
    tenant_id = db.Column(
        db.BigInteger, db.ForeignKey("tenants.id"), nullable=False, unique=True,
        comment="对应的企业租户 → tenants.id（一对一，业务归属一律用它）",
    )
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
    verified_at = db.Column(
        db.DateTime, nullable=True,
        comment="认证通过时间（UTC）；企业默认套餐自此起算，人工改 status 后由服务端补填",
    )
    external_ref = db.Column(db.String(64), nullable=False, default="", comment="外部系统引用号（预留）")
    policy_version = db.Column(db.Integer, nullable=False, default=1, comment="企业策略版本号（预留）")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "code": self.code,
            "country": self.country,
            "legal_name": self.legal_name,
            "registration_no": self.registration_no,
            "contact_phone": self.contact_phone,
            "cert_file_id": self.cert_file_id,
            "status": self.status,
            "verified_at": self.verified_at.isoformat() if self.verified_at else None,
        }


class Membership(db.Model, TimestampMixin):
    __tablename__ = "memberships"
    __table_args__ = (
        db.UniqueConstraint("tenant_id", "user_id", name="uq_membership_tenant_user"),
        {"comment": "企业成员关系（用户 × 企业租户，唯一）"},
    )

    id = db.Column(_bigint_pk(), primary_key=True, autoincrement=True, comment="主键")
    tenant_id = db.Column(
        db.BigInteger, db.ForeignKey("tenants.id"), nullable=False, comment="所属企业租户 → tenants.id"
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
    target_tenant_id = db.Column(
        db.BigInteger, db.ForeignKey("tenants.id"), nullable=False,
        comment="申请归属的租户 → tenants.id（个人套餐申请指向本人个人租户，入企/企业套餐指向企业租户）",
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
            "target_tenant_id": self.target_tenant_id,
            "submitted_at": self.submitted_at.isoformat() if self.submitted_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class Invitation(db.Model, TimestampMixin):
    __tablename__ = "invitations"
    __table_args__ = {"comment": "企业邀请（邀请令牌，库中仅存哈希）"}

    id = db.Column(_bigint_pk(), primary_key=True, autoincrement=True, comment="邀请 ID（自增主键）")
    token_hash = db.Column(db.String(64), nullable=False, unique=True, comment="邀请令牌的 SHA-256 哈希")
    tenant_id = db.Column(
        db.BigInteger, db.ForeignKey("tenants.id"), nullable=False, comment="邀请加入的企业租户 → tenants.id"
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
    tenant_id = db.Column(
        db.BigInteger, db.ForeignKey("tenants.id"), nullable=False, index=True,
        comment="归属租户 → tenants.id（个人或企业租户）",
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
        comment="文件状态：UPLOADING=上传中 / UPLOADED=已上传 / VALIDATING=校验中 / READY=可用 / REJECTED=被拒绝"
                " / DELETED=已删除（创建者删除待处理记录或取消上传）",
    )
    reject_reason = db.Column(db.String(255), nullable=False, default="", comment="被拒绝原因（消息键）")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
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
    tenant_id = db.Column(
        db.BigInteger, db.ForeignKey("tenants.id"), nullable=False, index=True,
        comment="归属租户 → tenants.id（与源文件同租户）",
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
    # 模板映射指针（FR-VERIFY-018）：不加外键，避免 ocr_jobs ↔ template_mappings 循环依赖
    current_mapping_id = db.Column(
        db.String(36), nullable=True,
        comment="当前结果版本所属的模板映射 → template_mappings.id；NULL=通用结果（不套用模板）",
    )
    pending_mapping_id = db.Column(
        db.String(36), nullable=True,
        comment="用户最近一次请求、尚未完成的模板映射 → template_mappings.id；NULL=无",
    )

    def stage(self) -> str:
        """流程阶段：OCR 处理中/失败 → 模板匹配中 → 数据验证中 → 数据已验证（未注册时确认）/ 最终完成。"""
        if self.status in ("FAILED", "CANCELLED"):
            return "OCR_FAILED"
        if self.status not in ("SUCCEEDED", "PARTIAL_SUCCESS"):
            return "OCR_PROCESSING"
        if self.review_status != "CONFIRMED":
            # 映射结束（READY/FAILED/中断回收）时 pending_mapping_id 必被清空，非空即仍在匹配/转换
            return "TEMPLATE_MATCHING" if self.pending_mapping_id else "VERIFYING"
        return "COMPLETED" if self.completed_at else "VERIFIED"

    def to_summary(self, file_name: str = "", template_name: str | None = None) -> dict:
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "file_id": self.file_id,
            "file_name": file_name,
            "template_name": template_name,  # 当前结果所属模板的显示名称；通用结果为 None
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
        }


# ---------- 结果版本与页结果 ----------


class ResultVersion(db.Model):
    __tablename__ = "result_versions"
    __table_args__ = (
        db.UniqueConstraint("job_id", "version", name="uq_result_version_job_version"),
        # 每个任务最多一个当前版本（部分唯一索引；旧库由 app._patch_columns 核查无重复后补建）
        db.Index(
            "uq_result_versions_job_current", "job_id", unique=True,
            postgresql_where=text("is_current"), sqlite_where=text("is_current"),
        ),
        {"comment": "识别结果版本（通用结果 v1 + 人工修改版本 + 模板映射版本，任务内版本号单一递增）"},
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
    mapping_id = db.Column(
        db.String(36), nullable=True, index=True,
        comment="该版本所属的模板映射 → template_mappings.id；NULL=通用结果（不套用模板）",
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
        db.BigInteger, db.ForeignKey("users.id"), nullable=True, index=True,
        comment="操作用户 → users.id；NULL=系统或后台脚本（如模板维护脚本、映射 Worker）",
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


# ---------- 订阅与到期提醒（PRD v1.4 §20） ----------


class Subscription(db.Model, TimestampMixin):
    """租户订阅（一个租户恰好一行）：套餐档位 + 有效期。

    默认开通：个人租户（含游客）建租户即 DEFAULT 默认套餐（plans.is_default，当前 KINDER）
    trial_months 个月；企业租户在 enterprises.status=VERIFIED 后按 verified_at 起算。到期即硬停，
    不再有 Free 档位与赠送次数兜底；续费由人工审批 PLAN_UPGRADE 申请时
    写入 form.valid_from / valid_to，读取订阅时据 application_id 惰性同步。
    """

    __tablename__ = "subscriptions"
    __table_args__ = {"comment": "租户订阅（套餐档位与有效期，一租户一行）"}

    id = db.Column(_bigint_pk(), primary_key=True, autoincrement=True, comment="主键")
    tenant_id = db.Column(
        db.BigInteger, db.ForeignKey("tenants.id"), nullable=False, unique=True,
        comment="订阅所属租户 → tenants.id（一对一）",
    )
    plan_code = db.Column(
        db.String(32), nullable=False, default="KINDER",
        comment="套餐代码 → plans.code（逻辑引用不加外键）：如 KINDER / STARTER / INTERMEDIATE / ADVANCE",
    )
    source = db.Column(
        db.String(16), nullable=False, default="DEFAULT",
        comment="权益来源：DEFAULT=系统默认开通一个月 / APPROVED=人工审批续费开通",
    )
    starts_at = db.Column(db.DateTime, nullable=False, default=_now, comment="本期生效时间（UTC）")
    expires_at = db.Column(db.DateTime, nullable=False, comment="本期到期时间（UTC），到期即停止新建任务")
    application_id = db.Column(
        db.BigInteger, db.ForeignKey("applications.id"), nullable=True,
        comment="最近一次据以续期的申请 → applications.id；默认开通为 NULL",
    )


class PlanReminder(db.Model):
    """到期提醒发送记录（幂等键：租户 + 本期到期时间 + 提醒节点）。

    续费后 period_end 变化，新周期重新按节点提醒；同一节点不重复发送。
    """

    __tablename__ = "plan_reminders"
    __table_args__ = (
        db.UniqueConstraint("tenant_id", "period_end", "stage", name="uq_plan_reminder_stage"),
        {"comment": "套餐到期提醒发送记录（站内通知 + 邮件，按节点幂等）"},
    )

    id = db.Column(_bigint_pk(), primary_key=True, autoincrement=True, comment="主键")
    tenant_id = db.Column(
        db.BigInteger, db.ForeignKey("tenants.id"), nullable=False, index=True,
        comment="提醒所属租户 → tenants.id",
    )
    period_end = db.Column(db.DateTime, nullable=False, comment="提醒对应的本期到期时间（UTC）")
    stage = db.Column(
        db.String(16), nullable=False,
        comment="提醒节点：D7/D3/D1=到期前 7/3/1 天 / D0=到期当天 / EXPIRED=已到期",
    )
    email_sent = db.Column(db.Boolean, nullable=False, default=False, comment="邮件是否发送成功")
    created_at = db.Column(db.DateTime, nullable=False, default=_now, comment="发送时间（UTC）")


class Plan(db.Model, TimestampMixin):
    """套餐配置（FR-SYS-019）：套餐目录、额度与默认开通规则的唯一来源。

    由 manage_plans.py 维护（PC 管理端后续接入），读取方经 plans.py 的进程内
    短缓存实时查询，改动对所有租户（含存量订阅）立即生效；不做订阅快照。
    多语言文案用 {en, th} JSON；只停用不删除，存量订阅引用的 code 恒可解析。
    """

    __tablename__ = "plans"
    __table_args__ = {"comment": "套餐配置（目录/价格展示/月页额度/席位/默认开通与续期规则，泰英双语）"}

    id = db.Column(_bigint_pk(), primary_key=True, autoincrement=True, comment="主键")
    code = db.Column(
        db.String(32), nullable=False, unique=True,
        comment="套餐代码（唯一，订阅与申请按此引用，创建后不可改）：如 KINDER / STARTER",
    )
    sort_order = db.Column(
        db.Integer, nullable=False, default=0,
        comment="展示与档位顺序（升序）；有效期内只允许申请不低于当前档位的套餐",
    )
    status = db.Column(
        db.String(16), nullable=False, default="ENABLED",
        comment="状态：ENABLED=在目录中展示且可申请 / DISABLED=停用（存量订阅照常按其额度计量）",
    )
    name = db.Column(db.JSON, nullable=False, comment="显示名称 JSON：{en, th}")
    price_display = db.Column(
        db.JSON, nullable=False, comment="价格展示文案 JSON：{en, th}（如 THB 888 / year、Contact us）"
    )
    monthly_thb = db.Column(db.Integer, nullable=True, comment="月付价格（泰铢）；NULL=无月付/面议")
    yearly_thb = db.Column(db.Integer, nullable=True, comment="年付价格（泰铢）；NULL=无年付/面议")
    quota_pages_per_month = db.Column(db.Integer, nullable=False, comment="每自然月 OCR 页数额度（OCR_PAGE）")
    seats = db.Column(db.Integer, nullable=False, default=1, comment="席位数（P0 仅展示，不做强制）")
    features = db.Column(
        db.JSON, nullable=False, comment="卖点列表 JSON：{en: [..], th: [..]}（json 列保留顺序）"
    )
    theme = db.Column(
        db.String(16), nullable=False, default="DEFAULT", comment="卡片样式：DEFAULT=浅色 / DARK=深色强调"
    )
    is_default = db.Column(
        db.Boolean, nullable=False, default=False,
        comment="是否默认开通套餐（新租户/企业认证后自动开通；启用套餐中恰好一个）",
    )
    trial_months = db.Column(
        db.Integer, nullable=False, default=1, comment="作为默认套餐时的默认开通月数（1~120）"
    )
    approved_period_months = db.Column(
        db.Integer, nullable=False, default=12,
        comment="人工审批未写有效期时的默认续期月数（1~120）",
    )


# ---------- 文档格式模板与模板映射（EPIC-08 / FR-OCR-018..021 / FR-VERIFY-018..020） ----------


class DocumentTemplate(db.Model, TimestampMixin):
    """文档格式模板：tenant_id 为 NULL 是系统模板，否则为租户模板。

    内容只存在不可变的 document_template_versions 中；本表只记录作用域、code、
    状态与当前版本指针。同一作用域内未删除的 code 唯一（部分唯一索引，COALESCE 让
    NULL 作用域也参与唯一判断）。
    """

    __tablename__ = "document_templates"
    __table_args__ = {"comment": "文档格式模板（系统模板 tenant_id 为 NULL；内容见 document_template_versions）"}

    id = db.Column(_bigint_pk(), primary_key=True, autoincrement=True, comment="模板 ID（自增主键）")
    tenant_id = db.Column(
        db.BigInteger, db.ForeignKey("tenants.id"), nullable=True, index=True,
        comment="所属租户 → tenants.id；NULL=系统模板（所有租户可用、只读）",
    )
    code = db.Column(db.String(64), nullable=False, comment="模板代码（作用域内唯一，脚本幂等导入的键）")
    name = db.Column(db.String(100), nullable=False, default="", comment="当前版本的显示名称快照（列表用）")
    status = db.Column(
        db.String(16), nullable=False, default="ENABLED",
        comment="模板状态：ENABLED=启用（参与匹配与选择） / DISABLED=停用（已有映射仍可读写）",
    )
    current_version_id = db.Column(
        db.BigInteger, nullable=True,
        comment="当前版本 → document_template_versions.id（不加外键，避免循环依赖）",
    )
    deleted_at = db.Column(db.DateTime, nullable=True, comment="软删除时间；NULL=未删除")


db.Index(
    "uq_document_templates_scope_code",
    func.coalesce(DocumentTemplate.tenant_id, 0), DocumentTemplate.code,
    unique=True,
    postgresql_where=DocumentTemplate.deleted_at.is_(None),
    sqlite_where=DocumentTemplate.deleted_at.is_(None),
)


class DocumentTemplateVersion(db.Model):
    __tablename__ = "document_template_versions"
    __table_args__ = (
        db.UniqueConstraint("template_id", "version", name="uq_template_version_no"),
        {"comment": "模板版本快照（只增不改；映射固定引用某个版本）"},
    )

    id = db.Column(_bigint_pk(), primary_key=True, autoincrement=True, comment="模板版本 ID（自增主键）")
    template_id = db.Column(
        db.BigInteger, db.ForeignKey("document_templates.id"), nullable=False, index=True,
        comment="所属模板 → document_templates.id",
    )
    version = db.Column(db.Integer, nullable=False, comment="模板内版本号（从 1 递增）")
    name = db.Column(db.String(100), nullable=False, comment="显示名称（建议「English / ไทย」）")
    description = db.Column(db.Text, nullable=False, default="", comment="模板描述（供大模型匹配）")
    groups = db.Column(
        db.JSON, nullable=False,
        comment="分组定义 JSON：[{key,name,description,items:[{kind:field|table,key,name,description,"
                "type,required,columns}]}]（json 列保留顺序）",
    )
    content_hash = db.Column(
        db.String(64), nullable=False, comment="规范化 name+description+groups 的 SHA-256（内容未变不升版）"
    )
    created_at = db.Column(db.DateTime, nullable=False, default=_now, comment="创建时间（UTC）")


class OcrRawResult(db.Model):
    """OCR 解析结果（原始结果）：TextIn llm_json 的不可变副本，一个任务一行。"""

    __tablename__ = "ocr_raw_results"
    __table_args__ = {"comment": "OCR 解析结果（TextIn llm_json 原样副本，只写一次，模板映射的唯一输入）"}

    id = db.Column(db.String(36), primary_key=True, default=_uuid, comment="OCR 解析结果 ID（UUID hex）")
    job_id = db.Column(
        db.String(36), db.ForeignKey("ocr_jobs.id"), nullable=False, unique=True,
        comment="所属任务 → ocr_jobs.id（一对一）",
    )
    payload = db.Column(db.JSON, nullable=True, comment="TextIn Prompt 模式 llm_json 原样（DeepSeek 整理之前）")
    created_at = db.Column(db.DateTime, nullable=False, default=_now, comment="创建时间（UTC）")


class TemplateMapping(db.Model, TimestampMixin):
    """一次「任务 + 模板版本」的映射尝试（PENDING→MATCHING→CONVERTING→READY/FAILED）。"""

    __tablename__ = "template_mappings"
    __table_args__ = {"comment": "模板映射（基于模板的解析结果的生成记录，READY 可复用、FAILED 保留）"}

    id = db.Column(db.String(36), primary_key=True, default=_uuid, comment="映射 ID（UUID hex）")
    job_id = db.Column(
        db.String(36), db.ForeignKey("ocr_jobs.id"), nullable=False, index=True, comment="所属任务 → ocr_jobs.id"
    )
    raw_result_id = db.Column(
        db.String(36), db.ForeignKey("ocr_raw_results.id"), nullable=False,
        comment="映射输入的 OCR 解析结果 → ocr_raw_results.id",
    )
    template_id = db.Column(
        db.BigInteger, db.ForeignKey("document_templates.id"), nullable=True,
        comment="使用的模板 → document_templates.id；AUTO 映射在匹配前为 NULL",
    )
    template_version_id = db.Column(
        db.BigInteger, db.ForeignKey("document_template_versions.id"), nullable=True, index=True,
        comment="固定使用的模板版本 → document_template_versions.id；AUTO 映射在匹配前为 NULL",
    )
    source = db.Column(db.String(16), nullable=False, comment="来源：AUTO=OCR 后自动匹配 / MANUAL=用户选择")
    status = db.Column(
        db.String(16), nullable=False, default="PENDING", index=True,
        comment="状态：PENDING=排队 / MATCHING=匹配中 / CONVERTING=转换中 / READY=成功 / FAILED=失败",
    )
    created_by_user_id = db.Column(
        db.BigInteger, db.ForeignKey("users.id"), nullable=True, comment="发起用户 → users.id；AUTO 为 NULL"
    )
    base_version_id = db.Column(
        db.String(36), nullable=True,
        comment="创建时任务的当前结果版本 → result_versions.id（自动生效条件；不加外键）",
    )
    result_version_id = db.Column(
        db.String(36), nullable=True,
        comment="转换成功后生成的结果版本 → result_versions.id（不加外键）",
    )
    match_score = db.Column(db.Float, nullable=True, comment="匹配得分 0~1；单候选直接选中或手动选择为 NULL")
    match_reason = db.Column(db.String(255), nullable=False, default="", comment="匹配理由（single_candidate / 模型理由）")
    candidates = db.Column(
        db.JSON, nullable=True, comment="匹配候选 top-3 JSON：[{template_id,template_version_id,score,reason}]"
    )
    warnings = db.Column(db.JSON, nullable=True, comment="类型标准化警告 JSON：[{path,code}]")
    dropped_keys = db.Column(db.Integer, nullable=False, default=0, comment="大模型输出中被丢弃的模板外键数")
    error_code = db.Column(db.String(64), nullable=False, default="", comment="失败错误码（MATCH_FAILED 等）")
    error_message = db.Column(db.String(512), nullable=False, default="", comment="失败原因（不含单据内容）")
    llm_calls = db.Column(db.Integer, nullable=False, default=0, comment="大模型调用次数（匹配 + 转换）")
    prompt_tokens = db.Column(db.Integer, nullable=False, default=0, comment="累计输入 token")
    completion_tokens = db.Column(db.Integer, nullable=False, default=0, comment="累计输出 token")
    model = db.Column(db.String(64), nullable=False, default="", comment="使用的大模型")
    prompt_version = db.Column(db.String(32), nullable=False, default="", comment="提示词版本（match-v1 / convert-v1）")
    duration_ms = db.Column(db.BigInteger, nullable=False, default=0, comment="映射耗时（毫秒）")
    started_at = db.Column(db.DateTime, nullable=True, comment="Worker 认领时间")
    finished_at = db.Column(db.DateTime, nullable=True, comment="结束（READY / FAILED）时间")
