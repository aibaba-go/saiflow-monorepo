-- =====================================================================
-- SaiFlow 数据库建表脚本（PostgreSQL 18）
-- 生成时间：2026-11-03 21:35:49；来源：services/api/models.py（与后端启动 db.create_all() 一致）
-- 表数量：24
-- 用法：psql "host=... dbname=postgres user=..." -v ON_ERROR_STOP=1 -f 01_schema.sql
-- 注意：仅用于空库初始化；不含 DROP，已存在的同名表会报错中止。
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS saiflow;
SET search_path TO saiflow;

BEGIN;
CREATE TABLE users (
	id BIGSERIAL NOT NULL, 
	line_provider VARCHAR(32) NOT NULL, 
	line_sub VARCHAR(128) NOT NULL, 
	display_name VARCHAR(128) NOT NULL, 
	avatar_url TEXT NOT NULL, 
	avatar_path VARCHAR(255) NOT NULL, 
	language VARCHAR(8) NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	phone VARCHAR(32) NOT NULL, 
	email VARCHAR(254) NOT NULL, 
	registered_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_users_line_identity UNIQUE (line_provider, line_sub)
);

COMMENT ON TABLE users IS '用户账号（LINE 正式用户与游客）';

COMMENT ON COLUMN users.id IS '用户 ID（自增主键）';

COMMENT ON COLUMN users.line_provider IS '身份来源：line=LINE 正式账号（含开发调试登录 dev:<id>）/ guest=游客试用';

COMMENT ON COLUMN users.line_sub IS '身份来源内的唯一标识（LINE userId / 游客随机 ID）';

COMMENT ON COLUMN users.display_name IS '显示名称';

COMMENT ON COLUMN users.avatar_url IS '外部头像 URL（仅 https，来自 LINE 资料）';

COMMENT ON COLUMN users.avatar_path IS '用户自行上传头像在对象存储中的对象名；非空时优先于 avatar_url';

COMMENT ON COLUMN users.language IS '界面语言：th / en';

COMMENT ON COLUMN users.status IS '账号状态：ACTIVE=正常 / DISABLED=禁用';

COMMENT ON COLUMN users.phone IS '手机号（默认 LINE 返回值，注册时可编辑；个人中心可修改）';

COMMENT ON COLUMN users.email IS '邮箱（注册前可为 LINE 默认值，注册后已验证）';

COMMENT ON COLUMN users.registered_at IS '完成注册信息录入的时间；NULL=尚未完成注册';

COMMENT ON COLUMN users.created_at IS '创建时间（UTC）';

COMMENT ON COLUMN users.updated_at IS '最后更新时间（UTC）';

CREATE TABLE review_sync_cursors (
	id BIGSERIAL NOT NULL, 
	source VARCHAR(32) NOT NULL, 
	cursor VARCHAR(128) NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (source)
);

COMMENT ON TABLE review_sync_cursors IS '外部审核主动拉取的幂等游标（接口冻结前仅保留结构）';

COMMENT ON COLUMN review_sync_cursors.id IS '主键';

COMMENT ON COLUMN review_sync_cursors.source IS '数据来源标识（唯一）';

COMMENT ON COLUMN review_sync_cursors.cursor IS '最近一次拉取到的游标位置';

COMMENT ON COLUMN review_sync_cursors.updated_at IS '游标更新时间（UTC）';

CREATE TABLE plans (
	id BIGSERIAL NOT NULL, 
	code VARCHAR(32) NOT NULL, 
	sort_order INTEGER NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	name JSON NOT NULL, 
	price_display JSON NOT NULL, 
	monthly_thb INTEGER, 
	yearly_thb INTEGER, 
	quota_pages_per_month INTEGER NOT NULL, 
	seats INTEGER NOT NULL, 
	features JSON NOT NULL, 
	theme VARCHAR(16) NOT NULL, 
	is_default BOOLEAN NOT NULL, 
	trial_months INTEGER NOT NULL, 
	approved_period_months INTEGER NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (code)
);

COMMENT ON TABLE plans IS '套餐配置（目录/价格展示/月页额度/席位/默认开通与续期规则，泰英双语）';

COMMENT ON COLUMN plans.id IS '主键';

COMMENT ON COLUMN plans.code IS '套餐代码（唯一，订阅与申请按此引用，创建后不可改）：如 KINDER / STARTER';

COMMENT ON COLUMN plans.sort_order IS '展示与档位顺序（升序）；有效期内只允许申请不低于当前档位的套餐';

COMMENT ON COLUMN plans.status IS '状态：ENABLED=在目录中展示且可申请 / DISABLED=停用（存量订阅照常按其额度计量）';

COMMENT ON COLUMN plans.name IS '显示名称 JSON：{en, th}';

COMMENT ON COLUMN plans.price_display IS '价格展示文案 JSON：{en, th}（如 THB 888 / year、Contact us）';

COMMENT ON COLUMN plans.monthly_thb IS '月付价格（泰铢）；NULL=无月付/面议';

COMMENT ON COLUMN plans.yearly_thb IS '年付价格（泰铢）；NULL=无年付/面议';

COMMENT ON COLUMN plans.quota_pages_per_month IS '每自然月 OCR 页数额度（OCR_PAGE）';

COMMENT ON COLUMN plans.seats IS '席位数（P0 仅展示，不做强制）';

COMMENT ON COLUMN plans.features IS '卖点列表 JSON：{en: [..], th: [..]}（json 列保留顺序）';

COMMENT ON COLUMN plans.theme IS '卡片样式：DEFAULT=浅色 / DARK=深色强调';

COMMENT ON COLUMN plans.is_default IS '是否默认开通套餐（新租户/企业认证后自动开通；启用套餐中恰好一个）';

COMMENT ON COLUMN plans.trial_months IS '作为默认套餐时的默认开通月数（1~120）';

COMMENT ON COLUMN plans.approved_period_months IS '人工审批未写有效期时的默认续期月数（1~120）';

COMMENT ON COLUMN plans.created_at IS '创建时间（UTC）';

COMMENT ON COLUMN plans.updated_at IS '最后更新时间（UTC）';

CREATE TABLE email_verification_codes (
	id BIGSERIAL NOT NULL, 
	user_id BIGINT NOT NULL, 
	email VARCHAR(254) NOT NULL, 
	code_hash VARCHAR(64) NOT NULL, 
	expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	consumed_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE INDEX ix_email_verification_codes_user_id ON email_verification_codes (user_id);

COMMENT ON TABLE email_verification_codes IS '邮箱验证码（绑定/修改邮箱时发送，库中仅存哈希）';

COMMENT ON COLUMN email_verification_codes.id IS '主键';

COMMENT ON COLUMN email_verification_codes.user_id IS '申请验证的用户 → users.id';

COMMENT ON COLUMN email_verification_codes.email IS '待验证的邮箱地址';

COMMENT ON COLUMN email_verification_codes.code_hash IS '验证码的 SHA-256 哈希（不存明文）';

COMMENT ON COLUMN email_verification_codes.expires_at IS '过期时间（UTC）';

COMMENT ON COLUMN email_verification_codes.consumed_at IS '验证码被成功使用的时间；NULL=未使用';

COMMENT ON COLUMN email_verification_codes.created_at IS '发送时间（UTC）';

CREATE TABLE sessions (
	id BIGSERIAL NOT NULL, 
	token_hash VARCHAR(64) NOT NULL, 
	user_id BIGINT NOT NULL, 
	csrf_hash VARCHAR(64) NOT NULL, 
	issued_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	absolute_expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	idle_expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	revoked_at TIMESTAMP WITHOUT TIME ZONE, 
	created_ip VARCHAR(64) NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (token_hash), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE INDEX ix_sessions_user_id ON sessions (user_id);

COMMENT ON TABLE sessions IS '登录会话（HttpOnly Cookie saiflow_session 对应的服务端记录）';

COMMENT ON COLUMN sessions.id IS '主键';

COMMENT ON COLUMN sessions.token_hash IS '会话令牌的 SHA-256 哈希（Cookie 中为明文令牌）';

COMMENT ON COLUMN sessions.user_id IS '会话所属用户 → users.id';

COMMENT ON COLUMN sessions.csrf_hash IS 'CSRF 令牌的 SHA-256 哈希（校验 X-CSRF-Token）';

COMMENT ON COLUMN sessions.issued_at IS '签发时间（UTC）';

COMMENT ON COLUMN sessions.absolute_expires_at IS '绝对过期时间（UTC），到期必须重新登录';

COMMENT ON COLUMN sessions.idle_expires_at IS '空闲过期时间（UTC），每次访问顺延';

COMMENT ON COLUMN sessions.revoked_at IS '主动注销/吊销时间；NULL=未吊销';

COMMENT ON COLUMN sessions.created_ip IS '创建会话时的客户端 IP';

CREATE TABLE tenants (
	id BIGSERIAL NOT NULL, 
	tenant_type VARCHAR(16) NOT NULL, 
	owner_user_id BIGINT, 
	display_name VARCHAR(255) NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_tenants_owner_user UNIQUE (owner_user_id), 
	FOREIGN KEY(owner_user_id) REFERENCES users (id)
);

COMMENT ON TABLE tenants IS '租户（个人用户与企业用户的统一归属主体，业务表按 tenant_id 归属）';

COMMENT ON COLUMN tenants.id IS '租户 ID（自增主键）';

COMMENT ON COLUMN tenants.tenant_type IS '租户类型：PERSONAL=个人租户（含游客） / ENTERPRISE=企业租户';

COMMENT ON COLUMN tenants.owner_user_id IS '个人租户的所属用户 → users.id（唯一，保证 1:1）；企业租户为 NULL';

COMMENT ON COLUMN tenants.display_name IS '租户显示名称（个人=用户昵称快照 / 企业=企业法定名称）';

COMMENT ON COLUMN tenants.status IS '租户可用性：ACTIVE=可用 / SUSPENDED=暂停 / DISABLED=停用（企业审核状态见 enterprises.status）';

COMMENT ON COLUMN tenants.created_at IS '创建时间（UTC）';

COMMENT ON COLUMN tenants.updated_at IS '最后更新时间（UTC）';

CREATE TABLE notifications (
	id BIGSERIAL NOT NULL, 
	user_id BIGINT NOT NULL, 
	type VARCHAR(32) NOT NULL, 
	title VARCHAR(128) NOT NULL, 
	body VARCHAR(512) NOT NULL, 
	read_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE INDEX ix_notifications_user_id ON notifications (user_id);

COMMENT ON TABLE notifications IS '站内通知';

COMMENT ON COLUMN notifications.id IS '主键';

COMMENT ON COLUMN notifications.user_id IS '接收用户 → users.id';

COMMENT ON COLUMN notifications.type IS '通知类型，默认 INFO';

COMMENT ON COLUMN notifications.title IS '标题';

COMMENT ON COLUMN notifications.body IS '正文';

COMMENT ON COLUMN notifications.read_at IS '已读时间；NULL=未读';

COMMENT ON COLUMN notifications.created_at IS '创建时间（UTC）';

CREATE TABLE audit_events (
	id BIGSERIAL NOT NULL, 
	user_id BIGINT, 
	action VARCHAR(64) NOT NULL, 
	object_type VARCHAR(32) NOT NULL, 
	object_id VARCHAR(64) NOT NULL, 
	detail JSON NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE INDEX ix_audit_events_user_id ON audit_events (user_id);

COMMENT ON TABLE audit_events IS '审计事件 / 用户操作记录';

COMMENT ON COLUMN audit_events.id IS '主键';

COMMENT ON COLUMN audit_events.user_id IS '操作用户 → users.id；NULL=系统或后台脚本（如模板维护脚本、映射 Worker）';

COMMENT ON COLUMN audit_events.action IS '操作动作（如 user.register）';

COMMENT ON COLUMN audit_events.object_type IS '操作对象类型';

COMMENT ON COLUMN audit_events.object_id IS '操作对象 ID';

COMMENT ON COLUMN audit_events.detail IS '附加详情 JSON';

COMMENT ON COLUMN audit_events.created_at IS '发生时间（UTC）';

CREATE TABLE data_requests (
	id BIGSERIAL NOT NULL, 
	user_id BIGINT NOT NULL, 
	kind VARCHAR(16) NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	note VARCHAR(255) NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	processed_at TIMESTAMP WITHOUT TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE INDEX ix_data_requests_user_id ON data_requests (user_id);

COMMENT ON TABLE data_requests IS 'PDPA 个人数据请求（查阅 / 删除）';

COMMENT ON COLUMN data_requests.id IS '主键';

COMMENT ON COLUMN data_requests.user_id IS '提出请求的用户 → users.id';

COMMENT ON COLUMN data_requests.kind IS '请求类型：ACCESS=查阅 / DELETION=删除';

COMMENT ON COLUMN data_requests.status IS '处理状态：PENDING=待处理 / DONE=已完成 / REJECTED=已拒绝';

COMMENT ON COLUMN data_requests.note IS '用户备注';

COMMENT ON COLUMN data_requests.created_at IS '提交时间（UTC）';

COMMENT ON COLUMN data_requests.processed_at IS '处理完成时间';

CREATE TABLE memberships (
	id BIGSERIAL NOT NULL, 
	tenant_id BIGINT NOT NULL, 
	user_id BIGINT NOT NULL, 
	role VARCHAR(16) NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	approved_via VARCHAR(32) NOT NULL, 
	decided_at TIMESTAMP WITHOUT TIME ZONE, 
	revoked_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_membership_tenant_user UNIQUE (tenant_id, user_id), 
	FOREIGN KEY(tenant_id) REFERENCES tenants (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE INDEX ix_memberships_user_id ON memberships (user_id);

COMMENT ON TABLE memberships IS '企业成员关系（用户 × 企业租户，唯一）';

COMMENT ON COLUMN memberships.id IS '主键';

COMMENT ON COLUMN memberships.tenant_id IS '所属企业租户 → tenants.id';

COMMENT ON COLUMN memberships.user_id IS '成员用户 → users.id';

COMMENT ON COLUMN memberships.role IS '成员角色：OWNER=所有者 / ADMIN=管理员 / MEMBER=普通成员';

COMMENT ON COLUMN memberships.status IS '成员状态：PENDING=待审批 / ACTIVE=有效 / REJECTED=已拒绝 / REMOVED=被移除 / LEFT=已退出';

COMMENT ON COLUMN memberships.approved_via IS '加入方式：CREATE=创建企业 / BIND=企业编号绑定 / APPLICATION=入企申请 / INVITATION=邀请';

COMMENT ON COLUMN memberships.decided_at IS '审批通过/拒绝的时间';

COMMENT ON COLUMN memberships.revoked_at IS '移除/退出（解绑）的时间';

COMMENT ON COLUMN memberships.created_at IS '创建时间（UTC）';

COMMENT ON COLUMN memberships.updated_at IS '最后更新时间（UTC）';

CREATE TABLE applications (
	id BIGSERIAL NOT NULL, 
	type VARCHAR(32) NOT NULL, 
	applicant_user_id BIGINT NOT NULL, 
	target_tenant_id BIGINT NOT NULL, 
	form JSON NOT NULL, 
	status VARCHAR(24) NOT NULL, 
	version INTEGER NOT NULL, 
	review_note VARCHAR(512) NOT NULL, 
	submitted_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(applicant_user_id) REFERENCES users (id), 
	FOREIGN KEY(target_tenant_id) REFERENCES tenants (id)
);

CREATE INDEX ix_applications_applicant_user_id ON applications (applicant_user_id);

COMMENT ON TABLE applications IS '申请单（企业认证 / 入企 / 套餐升级）';

COMMENT ON COLUMN applications.id IS '申请 ID（自增主键）';

COMMENT ON COLUMN applications.type IS '申请类型：ENTERPRISE_VERIFICATION=企业认证 / MEMBERSHIP=入企 / PLAN_UPGRADE=套餐升级';

COMMENT ON COLUMN applications.applicant_user_id IS '申请人 → users.id';

COMMENT ON COLUMN applications.target_tenant_id IS '申请归属的租户 → tenants.id（个人套餐申请指向本人个人租户，入企/企业套餐指向企业租户）';

COMMENT ON COLUMN applications.form IS '表单快照 JSON（企业：legal_name/country/registration_no/contact…；入企：message…）';

COMMENT ON COLUMN applications.status IS '申请状态：DRAFT/SUBMITTED/UNDER_REVIEW/NEEDS_INFO/APPROVED/REJECTED/WITHDRAWN（套餐升级 APPROVED=套餐已开通）';

COMMENT ON COLUMN applications.version IS '版本号（乐观并发控制）';

COMMENT ON COLUMN applications.review_note IS '审核意见';

COMMENT ON COLUMN applications.submitted_at IS '提交时间；NULL=草稿未提交';

COMMENT ON COLUMN applications.created_at IS '创建时间（UTC）';

COMMENT ON COLUMN applications.updated_at IS '最后更新时间（UTC）';

CREATE TABLE invitations (
	id BIGSERIAL NOT NULL, 
	token_hash VARCHAR(64) NOT NULL, 
	tenant_id BIGINT NOT NULL, 
	created_by_user_id BIGINT NOT NULL, 
	max_uses INTEGER NOT NULL, 
	use_count INTEGER NOT NULL, 
	expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (token_hash), 
	FOREIGN KEY(tenant_id) REFERENCES tenants (id), 
	FOREIGN KEY(created_by_user_id) REFERENCES users (id)
);

COMMENT ON TABLE invitations IS '企业邀请（邀请令牌，库中仅存哈希）';

COMMENT ON COLUMN invitations.id IS '邀请 ID（自增主键）';

COMMENT ON COLUMN invitations.token_hash IS '邀请令牌的 SHA-256 哈希';

COMMENT ON COLUMN invitations.tenant_id IS '邀请加入的企业租户 → tenants.id';

COMMENT ON COLUMN invitations.created_by_user_id IS '邀请创建人 → users.id';

COMMENT ON COLUMN invitations.max_uses IS '最多可使用次数';

COMMENT ON COLUMN invitations.use_count IS '已使用次数';

COMMENT ON COLUMN invitations.expires_at IS '过期时间（UTC）';

COMMENT ON COLUMN invitations.status IS '邀请状态：ACTIVE=有效 / REVOKED=已撤销 / EXPIRED=已过期';

COMMENT ON COLUMN invitations.created_at IS '创建时间（UTC）';

COMMENT ON COLUMN invitations.updated_at IS '最后更新时间（UTC）';

CREATE TABLE files (
	id VARCHAR(36) NOT NULL, 
	tenant_id BIGINT NOT NULL, 
	created_by_user_id BIGINT NOT NULL, 
	uploader_user_id BIGINT NOT NULL, 
	purpose VARCHAR(32) NOT NULL, 
	original_name VARCHAR(255) NOT NULL, 
	storage_path VARCHAR(512) NOT NULL, 
	mime_type VARCHAR(128) NOT NULL, 
	size_bytes BIGINT NOT NULL, 
	page_count INTEGER NOT NULL, 
	sha256 VARCHAR(64) NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	reject_reason VARCHAR(255) NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(tenant_id) REFERENCES tenants (id), 
	FOREIGN KEY(created_by_user_id) REFERENCES users (id), 
	FOREIGN KEY(uploader_user_id) REFERENCES users (id)
);

CREATE INDEX ix_files_tenant_id ON files (tenant_id);

CREATE INDEX ix_files_created_by_user_id ON files (created_by_user_id);

COMMENT ON TABLE files IS '上传文件（含上传会话生命周期；原件字节存私有对象存储）';

COMMENT ON COLUMN files.id IS '文件 ID（UUID hex），兼作上传会话 ID';

COMMENT ON COLUMN files.tenant_id IS '归属租户 → tenants.id（个人或企业租户）';

COMMENT ON COLUMN files.created_by_user_id IS '创建人 → users.id';

COMMENT ON COLUMN files.uploader_user_id IS '实际上传人 → users.id';

COMMENT ON COLUMN files.purpose IS '用途：OCR_TASK=OCR 识别原件 / APPLICATION_MATERIAL=申请材料';

COMMENT ON COLUMN files.original_name IS '原始文件名';

COMMENT ON COLUMN files.storage_path IS '对象存储中的对象路径';

COMMENT ON COLUMN files.mime_type IS 'MIME 类型';

COMMENT ON COLUMN files.size_bytes IS '文件大小（字节）';

COMMENT ON COLUMN files.page_count IS '页数（PDF 解析得出，图片为 1）';

COMMENT ON COLUMN files.sha256 IS '文件内容 SHA-256';

COMMENT ON COLUMN files.status IS '文件状态：UPLOADING=上传中 / UPLOADED=已上传 / VALIDATING=校验中 / READY=可用 / REJECTED=被拒绝 / DELETED=已删除（创建者删除待处理记录或取消上传）';

COMMENT ON COLUMN files.reject_reason IS '被拒绝原因（消息键）';

COMMENT ON COLUMN files.created_at IS '创建时间（UTC）';

COMMENT ON COLUMN files.updated_at IS '最后更新时间（UTC）';

CREATE TABLE plan_reminders (
	id BIGSERIAL NOT NULL, 
	tenant_id BIGINT NOT NULL, 
	period_end TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	stage VARCHAR(16) NOT NULL, 
	email_sent BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_plan_reminder_stage UNIQUE (tenant_id, period_end, stage), 
	FOREIGN KEY(tenant_id) REFERENCES tenants (id)
);

CREATE INDEX ix_plan_reminders_tenant_id ON plan_reminders (tenant_id);

COMMENT ON TABLE plan_reminders IS '套餐到期提醒发送记录（站内通知 + 邮件，按节点幂等）';

COMMENT ON COLUMN plan_reminders.id IS '主键';

COMMENT ON COLUMN plan_reminders.tenant_id IS '提醒所属租户 → tenants.id';

COMMENT ON COLUMN plan_reminders.period_end IS '提醒对应的本期到期时间（UTC）';

COMMENT ON COLUMN plan_reminders.stage IS '提醒节点：D7/D3/D1=到期前 7/3/1 天 / D0=到期当天 / EXPIRED=已到期';

COMMENT ON COLUMN plan_reminders.email_sent IS '邮件是否发送成功';

COMMENT ON COLUMN plan_reminders.created_at IS '发送时间（UTC）';

CREATE TABLE document_templates (
	id BIGSERIAL NOT NULL, 
	tenant_id BIGINT, 
	code VARCHAR(64) NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	current_version_id BIGINT, 
	deleted_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(tenant_id) REFERENCES tenants (id)
);

CREATE INDEX ix_document_templates_tenant_id ON document_templates (tenant_id);

CREATE UNIQUE INDEX uq_document_templates_scope_code ON document_templates (coalesce(tenant_id, 0), code) WHERE deleted_at IS NULL;

COMMENT ON TABLE document_templates IS '文档格式模板（系统模板 tenant_id 为 NULL；内容见 document_template_versions）';

COMMENT ON COLUMN document_templates.id IS '模板 ID（自增主键）';

COMMENT ON COLUMN document_templates.tenant_id IS '所属租户 → tenants.id；NULL=系统模板（所有租户可用、只读）';

COMMENT ON COLUMN document_templates.code IS '模板代码（作用域内唯一，脚本幂等导入的键）';

COMMENT ON COLUMN document_templates.name IS '当前版本的显示名称快照（列表用）';

COMMENT ON COLUMN document_templates.status IS '模板状态：ENABLED=启用（参与匹配与选择） / DISABLED=停用（已有映射仍可读写）';

COMMENT ON COLUMN document_templates.current_version_id IS '当前版本 → document_template_versions.id（不加外键，避免循环依赖）';

COMMENT ON COLUMN document_templates.deleted_at IS '软删除时间；NULL=未删除';

COMMENT ON COLUMN document_templates.created_at IS '创建时间（UTC）';

COMMENT ON COLUMN document_templates.updated_at IS '最后更新时间（UTC）';

CREATE TABLE enterprises (
	id BIGSERIAL NOT NULL, 
	tenant_id BIGINT NOT NULL, 
	code VARCHAR(32) NOT NULL, 
	country VARCHAR(8) NOT NULL, 
	legal_name VARCHAR(255) NOT NULL, 
	registration_no VARCHAR(64) NOT NULL, 
	contact_phone VARCHAR(32) NOT NULL, 
	cert_file_id VARCHAR(36), 
	status VARCHAR(32) NOT NULL, 
	verified_at TIMESTAMP WITHOUT TIME ZONE, 
	external_ref VARCHAR(64) NOT NULL, 
	policy_version INTEGER NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (tenant_id), 
	FOREIGN KEY(tenant_id) REFERENCES tenants (id), 
	UNIQUE (code), 
	FOREIGN KEY(cert_file_id) REFERENCES files (id)
);

COMMENT ON TABLE enterprises IS '企业（企业租户的专有信息；共性信息在 tenants）';

COMMENT ON COLUMN enterprises.id IS '企业 ID（自增主键）';

COMMENT ON COLUMN enterprises.tenant_id IS '对应的企业租户 → tenants.id（一对一，业务归属一律用它）';

COMMENT ON COLUMN enterprises.code IS '企业编号（形如 ent-yymmdd-xxxxxx），成员凭此绑定企业';

COMMENT ON COLUMN enterprises.country IS '国家/地区代码，默认 TH';

COMMENT ON COLUMN enterprises.legal_name IS '企业法定名称';

COMMENT ON COLUMN enterprises.registration_no IS '工商/税务登记号';

COMMENT ON COLUMN enterprises.contact_phone IS '企业联系电话';

COMMENT ON COLUMN enterprises.cert_file_id IS '营业执照等认证材料文件 → files.id';

COMMENT ON COLUMN enterprises.status IS '企业状态：PENDING_VERIFICATION=待认证 / VERIFIED=已认证 / SUSPENDED=暂停 / DISABLED=停用';

COMMENT ON COLUMN enterprises.verified_at IS '认证通过时间（UTC）；企业默认套餐自此起算，人工改 status 后由服务端补填';

COMMENT ON COLUMN enterprises.external_ref IS '外部系统引用号（预留）';

COMMENT ON COLUMN enterprises.policy_version IS '企业策略版本号（预留）';

COMMENT ON COLUMN enterprises.created_at IS '创建时间（UTC）';

COMMENT ON COLUMN enterprises.updated_at IS '最后更新时间（UTC）';

CREATE TABLE ocr_jobs (
	id VARCHAR(36) NOT NULL, 
	tenant_id BIGINT NOT NULL, 
	created_by_user_id BIGINT NOT NULL, 
	file_id VARCHAR(36) NOT NULL, 
	params JSON NOT NULL, 
	capability JSON NOT NULL, 
	status VARCHAR(24) NOT NULL, 
	idempotency_key VARCHAR(128), 
	parent_job_id VARCHAR(36), 
	progress INTEGER NOT NULL, 
	error_code VARCHAR(64) NOT NULL, 
	error_message VARCHAR(512) NOT NULL, 
	vendor_request_id VARCHAR(64) NOT NULL, 
	page_count INTEGER NOT NULL, 
	table_count INTEGER NOT NULL, 
	field_count INTEGER NOT NULL, 
	duration_ms BIGINT NOT NULL, 
	missing_pages JSON, 
	review_status VARCHAR(16) NOT NULL, 
	started_at TIMESTAMP WITHOUT TIME ZONE, 
	finished_at TIMESTAMP WITHOUT TIME ZONE, 
	completed_at TIMESTAMP WITHOUT TIME ZONE, 
	current_mapping_id VARCHAR(36), 
	pending_mapping_id VARCHAR(36), 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(tenant_id) REFERENCES tenants (id), 
	FOREIGN KEY(created_by_user_id) REFERENCES users (id), 
	FOREIGN KEY(file_id) REFERENCES files (id), 
	UNIQUE (idempotency_key)
);

CREATE INDEX ix_ocr_jobs_status ON ocr_jobs (status);

CREATE INDEX ix_ocr_jobs_tenant_id ON ocr_jobs (tenant_id);

CREATE INDEX ix_ocr_jobs_created_by_user_id ON ocr_jobs (created_by_user_id);

COMMENT ON TABLE ocr_jobs IS 'OCR 识别任务（自有队列表，由进程内 worker 轮询驱动）';

COMMENT ON COLUMN ocr_jobs.id IS '任务 ID（UUID hex）';

COMMENT ON COLUMN ocr_jobs.tenant_id IS '归属租户 → tenants.id（与源文件同租户）';

COMMENT ON COLUMN ocr_jobs.created_by_user_id IS '创建人 → users.id';

COMMENT ON COLUMN ocr_jobs.file_id IS '识别的原件 → files.id';

COMMENT ON COLUMN ocr_jobs.params IS '任务参数 JSON（起始页 page、页数 page_count、字段 field_names 等）';

COMMENT ON COLUMN ocr_jobs.capability IS '创建时的 TextIn 能力快照 JSON';

COMMENT ON COLUMN ocr_jobs.status IS '任务状态：QUEUED/PREPROCESSING/PROCESSING/POSTPROCESSING/SUCCEEDED/PARTIAL_SUCCESS/FAILED/CANCEL_REQUESTED/CANCELLED';

COMMENT ON COLUMN ocr_jobs.idempotency_key IS '创建请求的幂等键（防重复提交）';

COMMENT ON COLUMN ocr_jobs.parent_job_id IS '重新识别（rerun）时的来源任务 ID';

COMMENT ON COLUMN ocr_jobs.progress IS '进度百分比 0-100';

COMMENT ON COLUMN ocr_jobs.error_code IS '失败错误码';

COMMENT ON COLUMN ocr_jobs.error_message IS '失败错误信息';

COMMENT ON COLUMN ocr_jobs.vendor_request_id IS 'TextIn 请求 ID（排障用）';

COMMENT ON COLUMN ocr_jobs.page_count IS '识别页数';

COMMENT ON COLUMN ocr_jobs.table_count IS '识别出的表格数';

COMMENT ON COLUMN ocr_jobs.field_count IS '识别出的字段数';

COMMENT ON COLUMN ocr_jobs.duration_ms IS '识别耗时（毫秒）';

COMMENT ON COLUMN ocr_jobs.missing_pages IS 'PARTIAL_SUCCESS 时未识别成功的页码 JSON 数组';

COMMENT ON COLUMN ocr_jobs.review_status IS '核验状态：UNREVIEWED=未核验 / EDITED=已修改 / CONFIRMED=已确认';

COMMENT ON COLUMN ocr_jobs.started_at IS '开始处理时间';

COMMENT ON COLUMN ocr_jobs.finished_at IS '识别结束（成功/失败/取消）时间';

COMMENT ON COLUMN ocr_jobs.completed_at IS '已注册用户确认结果的时间（最终完成）；游客/未注册用户确认后为空（数据已验证）';

COMMENT ON COLUMN ocr_jobs.current_mapping_id IS '当前结果版本所属的模板映射 → template_mappings.id；NULL=通用结果（不套用模板）';

COMMENT ON COLUMN ocr_jobs.pending_mapping_id IS '用户最近一次请求、尚未完成的模板映射 → template_mappings.id；NULL=无';

COMMENT ON COLUMN ocr_jobs.created_at IS '创建时间（UTC）';

COMMENT ON COLUMN ocr_jobs.updated_at IS '最后更新时间（UTC）';

CREATE TABLE subscriptions (
	id BIGSERIAL NOT NULL, 
	tenant_id BIGINT NOT NULL, 
	plan_code VARCHAR(32) NOT NULL, 
	source VARCHAR(16) NOT NULL, 
	starts_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	application_id BIGINT, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (tenant_id), 
	FOREIGN KEY(tenant_id) REFERENCES tenants (id), 
	FOREIGN KEY(application_id) REFERENCES applications (id)
);

COMMENT ON TABLE subscriptions IS '租户订阅（套餐档位与有效期，一租户一行）';

COMMENT ON COLUMN subscriptions.id IS '主键';

COMMENT ON COLUMN subscriptions.tenant_id IS '订阅所属租户 → tenants.id（一对一）';

COMMENT ON COLUMN subscriptions.plan_code IS '套餐代码 → plans.code（逻辑引用不加外键）：如 KINDER / STARTER / INTERMEDIATE / ADVANCE';

COMMENT ON COLUMN subscriptions.source IS '权益来源：DEFAULT=系统默认开通一个月 / APPROVED=人工审批续费开通';

COMMENT ON COLUMN subscriptions.starts_at IS '本期生效时间（UTC）';

COMMENT ON COLUMN subscriptions.expires_at IS '本期到期时间（UTC），到期即停止新建任务';

COMMENT ON COLUMN subscriptions.application_id IS '最近一次据以续期的申请 → applications.id；默认开通为 NULL';

COMMENT ON COLUMN subscriptions.created_at IS '创建时间（UTC）';

COMMENT ON COLUMN subscriptions.updated_at IS '最后更新时间（UTC）';

CREATE TABLE document_template_versions (
	id BIGSERIAL NOT NULL, 
	template_id BIGINT NOT NULL, 
	version INTEGER NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	description TEXT NOT NULL, 
	groups JSON NOT NULL, 
	content_hash VARCHAR(64) NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_template_version_no UNIQUE (template_id, version), 
	FOREIGN KEY(template_id) REFERENCES document_templates (id)
);

CREATE INDEX ix_document_template_versions_template_id ON document_template_versions (template_id);

COMMENT ON TABLE document_template_versions IS '模板版本快照（只增不改；映射固定引用某个版本）';

COMMENT ON COLUMN document_template_versions.id IS '模板版本 ID（自增主键）';

COMMENT ON COLUMN document_template_versions.template_id IS '所属模板 → document_templates.id';

COMMENT ON COLUMN document_template_versions.version IS '模板内版本号（从 1 递增）';

COMMENT ON COLUMN document_template_versions.name IS '显示名称（建议「English / ไทย」）';

COMMENT ON COLUMN document_template_versions.description IS '模板描述（供大模型匹配）';

COMMENT ON COLUMN document_template_versions.groups IS '分组定义 JSON：[{key,name,description,items:[{kind:field|table,key,name,description,type,required,columns}]}]（json 列保留顺序）';

COMMENT ON COLUMN document_template_versions.content_hash IS '规范化 name+description+groups 的 SHA-256（内容未变不升版）';

COMMENT ON COLUMN document_template_versions.created_at IS '创建时间（UTC）';

CREATE TABLE result_versions (
	id VARCHAR(36) NOT NULL, 
	job_id VARCHAR(36) NOT NULL, 
	version INTEGER NOT NULL, 
	is_current BOOLEAN NOT NULL, 
	created_by_user_id BIGINT, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	structured JSON, 
	mapping_id VARCHAR(36), 
	PRIMARY KEY (id), 
	CONSTRAINT uq_result_version_job_version UNIQUE (job_id, version), 
	FOREIGN KEY(job_id) REFERENCES ocr_jobs (id), 
	FOREIGN KEY(created_by_user_id) REFERENCES users (id)
);

CREATE INDEX ix_result_versions_mapping_id ON result_versions (mapping_id);

CREATE UNIQUE INDEX uq_result_versions_job_current ON result_versions (job_id) WHERE is_current;

CREATE INDEX ix_result_versions_job_id ON result_versions (job_id);

COMMENT ON TABLE result_versions IS '识别结果版本（通用结果 v1 + 人工修改版本 + 模板映射版本，任务内版本号单一递增）';

COMMENT ON COLUMN result_versions.id IS '结果版本 ID（UUID hex）';

COMMENT ON COLUMN result_versions.job_id IS '所属任务 → ocr_jobs.id';

COMMENT ON COLUMN result_versions.version IS '版本号（任务内从 1 递增）';

COMMENT ON COLUMN result_versions.is_current IS '是否为当前生效版本';

COMMENT ON COLUMN result_versions.created_by_user_id IS '保存该版本的用户 → users.id；OCR 生成为 NULL';

COMMENT ON COLUMN result_versions.created_at IS '创建时间（UTC）';

COMMENT ON COLUMN result_versions.structured IS 'TextIn Prompt 模式返回的结构化 JSON（字段 + 表格）；旧版逐页结果为 NULL';

COMMENT ON COLUMN result_versions.mapping_id IS '该版本所属的模板映射 → template_mappings.id；NULL=通用结果（不套用模板）';

CREATE TABLE ocr_raw_results (
	id VARCHAR(36) NOT NULL, 
	job_id VARCHAR(36) NOT NULL, 
	payload JSON, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (job_id), 
	FOREIGN KEY(job_id) REFERENCES ocr_jobs (id)
);

COMMENT ON TABLE ocr_raw_results IS 'OCR 解析结果（TextIn llm_json 原样副本，只写一次，模板映射的唯一输入）';

COMMENT ON COLUMN ocr_raw_results.id IS 'OCR 解析结果 ID（UUID hex）';

COMMENT ON COLUMN ocr_raw_results.job_id IS '所属任务 → ocr_jobs.id（一对一）';

COMMENT ON COLUMN ocr_raw_results.payload IS 'TextIn Prompt 模式 llm_json 原样（DeepSeek 整理之前）';

COMMENT ON COLUMN ocr_raw_results.created_at IS '创建时间（UTC）';

CREATE TABLE page_results (
	id VARCHAR(36) NOT NULL, 
	result_version_id VARCHAR(36) NOT NULL, 
	page_number INTEGER NOT NULL, 
	text TEXT NOT NULL, 
	tables JSON NOT NULL, 
	fields JSON NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_page_result_version_page UNIQUE (result_version_id, page_number), 
	FOREIGN KEY(result_version_id) REFERENCES result_versions (id)
);

CREATE INDEX ix_page_results_result_version_id ON page_results (result_version_id);

COMMENT ON TABLE page_results IS '逐页识别结果（文本 / 表格 / 字段）';

COMMENT ON COLUMN page_results.id IS '主键（UUID hex）';

COMMENT ON COLUMN page_results.result_version_id IS '所属结果版本 → result_versions.id';

COMMENT ON COLUMN page_results.page_number IS '原始页码（从 1 开始）';

COMMENT ON COLUMN page_results.text IS '整页识别文本';

COMMENT ON COLUMN page_results.tables IS '表格 JSON：[{table_id,row_count,column_count,cells:[{row_index,column_index,row_span,column_span,raw_text,current_text,polygon,confidence,review_status}]}]';

COMMENT ON COLUMN page_results.fields IS '字段 JSON：[{name,value,source,source_page}]';

CREATE TABLE exports (
	id VARCHAR(36) NOT NULL, 
	job_id VARCHAR(36) NOT NULL, 
	result_version_id VARCHAR(36) NOT NULL, 
	format VARCHAR(8) NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	storage_path VARCHAR(512) NOT NULL, 
	expires_at TIMESTAMP WITHOUT TIME ZONE, 
	created_by_user_id BIGINT NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(job_id) REFERENCES ocr_jobs (id), 
	FOREIGN KEY(result_version_id) REFERENCES result_versions (id), 
	FOREIGN KEY(created_by_user_id) REFERENCES users (id)
);

CREATE INDEX ix_exports_job_id ON exports (job_id);

COMMENT ON TABLE exports IS '结果导出文件（XLSX/CSV/TXT，限时下载）';

COMMENT ON COLUMN exports.id IS '导出 ID（UUID hex）';

COMMENT ON COLUMN exports.job_id IS '所属任务 → ocr_jobs.id';

COMMENT ON COLUMN exports.result_version_id IS '导出所基于的结果版本 → result_versions.id';

COMMENT ON COLUMN exports.format IS '导出格式：XLSX / CSV / TXT';

COMMENT ON COLUMN exports.status IS '导出状态：GENERATING=生成中 / READY=可下载 / EXPIRED=已过期 / FAILED=失败';

COMMENT ON COLUMN exports.storage_path IS '导出文件在对象存储中的路径';

COMMENT ON COLUMN exports.expires_at IS '下载过期时间（UTC）';

COMMENT ON COLUMN exports.created_by_user_id IS '发起导出的用户 → users.id';

COMMENT ON COLUMN exports.created_at IS '创建时间（UTC）';

COMMENT ON COLUMN exports.updated_at IS '最后更新时间（UTC）';

CREATE TABLE template_mappings (
	id VARCHAR(36) NOT NULL, 
	job_id VARCHAR(36) NOT NULL, 
	raw_result_id VARCHAR(36) NOT NULL, 
	template_id BIGINT, 
	template_version_id BIGINT, 
	source VARCHAR(16) NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	created_by_user_id BIGINT, 
	base_version_id VARCHAR(36), 
	result_version_id VARCHAR(36), 
	match_score FLOAT, 
	match_reason VARCHAR(255) NOT NULL, 
	candidates JSON, 
	warnings JSON, 
	dropped_keys INTEGER NOT NULL, 
	error_code VARCHAR(64) NOT NULL, 
	error_message VARCHAR(512) NOT NULL, 
	llm_calls INTEGER NOT NULL, 
	prompt_tokens INTEGER NOT NULL, 
	completion_tokens INTEGER NOT NULL, 
	model VARCHAR(64) NOT NULL, 
	prompt_version VARCHAR(32) NOT NULL, 
	duration_ms BIGINT NOT NULL, 
	started_at TIMESTAMP WITHOUT TIME ZONE, 
	finished_at TIMESTAMP WITHOUT TIME ZONE, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(job_id) REFERENCES ocr_jobs (id), 
	FOREIGN KEY(raw_result_id) REFERENCES ocr_raw_results (id), 
	FOREIGN KEY(template_id) REFERENCES document_templates (id), 
	FOREIGN KEY(template_version_id) REFERENCES document_template_versions (id), 
	FOREIGN KEY(created_by_user_id) REFERENCES users (id)
);

CREATE INDEX ix_template_mappings_status ON template_mappings (status);

CREATE INDEX ix_template_mappings_template_version_id ON template_mappings (template_version_id);

CREATE INDEX ix_template_mappings_job_id ON template_mappings (job_id);

COMMENT ON TABLE template_mappings IS '模板映射（基于模板的解析结果的生成记录，READY 可复用、FAILED 保留）';

COMMENT ON COLUMN template_mappings.id IS '映射 ID（UUID hex）';

COMMENT ON COLUMN template_mappings.job_id IS '所属任务 → ocr_jobs.id';

COMMENT ON COLUMN template_mappings.raw_result_id IS '映射输入的 OCR 解析结果 → ocr_raw_results.id';

COMMENT ON COLUMN template_mappings.template_id IS '使用的模板 → document_templates.id；AUTO 映射在匹配前为 NULL';

COMMENT ON COLUMN template_mappings.template_version_id IS '固定使用的模板版本 → document_template_versions.id；AUTO 映射在匹配前为 NULL';

COMMENT ON COLUMN template_mappings.source IS '来源：AUTO=OCR 后自动匹配 / MANUAL=用户选择';

COMMENT ON COLUMN template_mappings.status IS '状态：PENDING=排队 / MATCHING=匹配中 / CONVERTING=转换中 / READY=成功 / FAILED=失败';

COMMENT ON COLUMN template_mappings.created_by_user_id IS '发起用户 → users.id；AUTO 为 NULL';

COMMENT ON COLUMN template_mappings.base_version_id IS '创建时任务的当前结果版本 → result_versions.id（自动生效条件；不加外键）';

COMMENT ON COLUMN template_mappings.result_version_id IS '转换成功后生成的结果版本 → result_versions.id（不加外键）';

COMMENT ON COLUMN template_mappings.match_score IS '匹配得分 0~1；单候选直接选中或手动选择为 NULL';

COMMENT ON COLUMN template_mappings.match_reason IS '匹配理由（single_candidate / 模型理由）';

COMMENT ON COLUMN template_mappings.candidates IS '匹配候选 top-3 JSON：[{template_id,template_version_id,score,reason}]';

COMMENT ON COLUMN template_mappings.warnings IS '类型标准化警告 JSON：[{path,code}]';

COMMENT ON COLUMN template_mappings.dropped_keys IS '大模型输出中被丢弃的模板外键数';

COMMENT ON COLUMN template_mappings.error_code IS '失败错误码（MATCH_FAILED 等）';

COMMENT ON COLUMN template_mappings.error_message IS '失败原因（不含单据内容）';

COMMENT ON COLUMN template_mappings.llm_calls IS '大模型调用次数（匹配 + 转换）';

COMMENT ON COLUMN template_mappings.prompt_tokens IS '累计输入 token';

COMMENT ON COLUMN template_mappings.completion_tokens IS '累计输出 token';

COMMENT ON COLUMN template_mappings.model IS '使用的大模型';

COMMENT ON COLUMN template_mappings.prompt_version IS '提示词版本（match-v1 / convert-v1）';

COMMENT ON COLUMN template_mappings.duration_ms IS '映射耗时（毫秒）';

COMMENT ON COLUMN template_mappings.started_at IS 'Worker 认领时间';

COMMENT ON COLUMN template_mappings.finished_at IS '结束（READY / FAILED）时间';

COMMENT ON COLUMN template_mappings.created_at IS '创建时间（UTC）';

COMMENT ON COLUMN template_mappings.updated_at IS '最后更新时间（UTC）';

COMMIT;
