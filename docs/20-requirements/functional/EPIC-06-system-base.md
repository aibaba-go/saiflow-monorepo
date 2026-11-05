---
doc_id: EPIC-06
title: "EPIC-06 — 基础系统（账户、权限、配置、i18n）"
type: epic
status: active
version: 1.7.5
updated: 2026-11-06
owner: Product Engineering
priority: P0
source: "PRD-001 §4.6"
related: [DM-User, DM-Role, DM-OperationLog, API-8]
---

# EPIC-06 — 基础系统（账户、权限、配置、i18n）

> **注意（2026-10-30）：** 本 Epic 尚未按 PRD v3 改写，与 `PRD-SaiFlow.md` v3.1 冲突时以 PRD 为准；将随 ADR-006 §7 的重建步骤迁入 `openspec/specs/`。文中引用的 `Architecture` / `Data-Model` 旧章节细节见 git tag `legacy-v1` 中的版本。

## 1. Epic 摘要
- **目标：** 提供每个其他 epic 都依赖的基础系统服务：身份、基于角色的访问控制、操作审计、多语言 UI 和本地配置。
- **范围内：** 注册/登录、RBAC 权限、操作日志、语言切换（泰语/英语/中文）、基础参数配置、本地存储设置。
- **主要参与者：** P-07 系统管理员（配置）；所有用户（登录/语言）。
- **关键实体：** `DM-User`、`DM-Role`、`DM-OperationLog`、`DM-Settings`；租户与订阅相关表 `tenants`、`enterprises`、`subscriptions`、`plan_reminders`（见 [Data-Model §2.13.1](../../30-design/Data-Model.md)）。

## 2. 需求

| ID | 陈述（系统必须……） | 优先级 | 来源 | 依赖项 | 验证方式 |
|----|--------------------|--------|------|--------|----------|
| FR-SYS-001 | **已迁移至 `openspec/specs/identity/spec.md`（deprecated）** 支持用户注册和登录：线上仅通过真实 LINE 联合认证，本地开发仅在明确启用时允许独立的 Developer sign-in（dev 身份） | P0 | §4.6；用户认证边界调整 2026-10-27；初始化恢复修复 2026-10-28 | — | AC-FR-SYS-001-01/02/03/04/05/06/07 |
| FR-SYS-002 | **已迁移至 `openspec/specs/tenancy/spec.md`（deprecated）** 强制实施基于角色的访问权限 | P0 | §4.6 | FR-SYS-001 | AC-FR-SYS-002-01 |
| FR-SYS-003 | **已迁移至 `openspec/specs/identity/spec.md`（deprecated）** 为每个改变状态的操作记录操作日志 | P0 | §4.6,§5.3 | FR-SYS-001 | AC-FR-SYS-003-01 |
| FR-SYS-004 | **已迁移至 `openspec/specs/line-mini/spec.md`（deprecated）** 允许在泰语 / 英语 / 中文之间切换 UI 语言 | P0 | §4.6 | — | AC-FR-SYS-004-01 |
| FR-SYS-005 | **已迁移至 `openspec/specs/ocr-settings/spec.md`（deprecated）** 提供基础参数配置（路径、阈值、模板） | P0 | §4.6 | FR-SYS-002 | AC-FR-SYS-005-01 |
| FR-SYS-006 | 提供归档与存储设置（GCS 对象前缀、命名规则） | P0 | §4.6 | FR-SYS-002 | AC-FR-SYS-006-01 |
| FR-SYS-009 | **已迁移至 `openspec/specs/tenancy/spec.md`（deprecated）** 允许管理员为角色授予复核与报表查看权限 | P0 | PRD §1.2, §4.6 | FR-SYS-002 | AC-FR-SYS-009-01 |
| FR-SYS-007 | 重复登录失败后锁定账户 | P1 | §5.3 | FR-SYS-001 | AC-FR-SYS-007-01 |
| FR-SYS-008 | 保留每位用户的偏好（语言、默认导出路径） | P1 | §4.6 | FR-SYS-001 | AC-FR-SYS-008-01 |
| FR-SYS-010 | **已迁移至 `openspec/specs/identity/spec.md`（deprecated）** 启动以有效应用 Cookie 或游客会话进入主壳，不以残留 LIFF token 自动登录；游客可上传、识别、编辑核验草稿，显式登录后归集其数据 | P0 | 用户流程调整 2026-10-17/27 | FR-SYS-001 | AC-FR-SYS-010-01/02 |
| FR-SYS-011 | 仅结果核验页 Continue 在确认前要求游客或未注册用户进入 auth 登录/注册；有 dirty 变更先保存 confirm:false，不跳订阅页；成功仅恢复 result（原已 COMPLETED 可 final），取消保留任务权限且不自动续接或确认；服务端 confirm:true 强制已注册 | P0 | 用户流程调整 2026-10-27 | FR-SYS-001, FR-SYS-010 | AC-FR-SYS-011-01/02 |
| FR-SYS-012 | **已迁移至 `openspec/specs/billing/spec.md`（deprecated）** 每个租户（个人、游客、已认证企业）自动开通且只开通一个月 Kinder：个人自 `tenants.created_at` 起算，企业自 `enterprises.verified_at` 起算，未认证企业无订阅行为 `NONE`；到期即硬停，新建识别任务返回 `402 PLAN_EXPIRED`，历史任务与结果仍可查看；续费/升级由线下审批写入有效期后惰性生效 | P0 | 用户流程调整 2026-10-27；套餐到期调整 2026-10-28 | FR-SYS-011 | AC-FR-SYS-012-01/02/03/04/05 |
| FR-SYS-013 | **已迁移至 `openspec/specs/billing/spec.md`（deprecated）** 唯一计量单位为 `OCR_PAGE` 每月页数：按泰国自然月实时统计该租户非 FAILED/CANCELLED 任务的页数，各档 KINDER 1,000 / STARTER 5,000 / INTERMEDIATE 10,000 / ADVANCE 100,000；没有 FREE 档位、没有赠送任务额度、没有额度流水表；订阅有效但页数用尽返回 `402 QUOTA_EXCEEDED`；游客首页不显示套餐横幅 | P0 | 用户流程调整 2026-10-27；套餐到期调整 2026-10-28 | FR-SYS-012 | AC-FR-SYS-013-01/02/03/04 |
| FR-SYS-014 | **已迁移至 `openspec/specs/identity/spec.md`（deprecated）** 通过 LINE 注册：仅 route=auth 且 needsRegistration 时显示注册框，首页/上传/开始 OCR 不弹；手机号默认取 LINE 返回值，可编辑保存或手填且可选；邮箱默认取服务端验证的 LINE token（email scope/用户授权），可编辑且必填，须凭 TLS SMTP 实发验证码确认；昵称、头像取 LINE 且可改，校验后完成注册 | P0 | 用户流程调整 2026-10-17/18/27 | FR-SYS-001 | AC-FR-SYS-014-01/02/03/04/05 |
| FR-SYS-015 | **已迁移至 `openspec/specs/identity/spec.md`（deprecated）** 个人中心（My）可修改用户昵称、头像与手机号（手机号可清空，按格式校验，游客不可修改） | P0 | 用户流程调整 2026-10-17；资料调整 2026-10-28 | FR-SYS-014 | AC-FR-SYS-015-01/02 |
| FR-SYS-016 | **已迁移至 `openspec/specs/identity/spec.md`（deprecated）** 个人中心（My）可更换邮箱：输入新邮箱，系统向新邮箱发送验证码，凭验证码确认更换 | P0 | 用户流程调整 2026-10-17 | FR-SYS-014 | AC-FR-SYS-016-01/02 |
| FR-SYS-017 | **已迁移至 `openspec/specs/tenancy/spec.md`（deprecated）** 租户（个人 / 已认证企业）可切换且刷新后保持；各租户的任务数据、订阅与月页计量相互隔离，企业租户的数据、订阅与月页由该企业全体有效成员共享 | P0 | 用户流程调整 2026-10-18；归属调整 2026-10-28 | FR-SYS-002, FR-SYS-012 | AC-FR-SYS-017-01/02/03 |
| FR-SYS-018 | **已迁移至 `openspec/specs/notifications/spec.md`（deprecated）** 在到期前 7/3/1 天、到期当天与到期后各发一次站内通知（并在有邮箱的已注册用户上附带邮件），同一租户同一周期同一节点不重复、错过的节点不回补，游客不提醒；通知中心可查询未读数并将通知标记已读 | P0 | 套餐到期调整 2026-10-28 | FR-SYS-012 | AC-FR-SYS-018-01/02/03 |

## 3. 角色与权限（RBAC）

| 角色 | 上传 | 核验 | 复核 | 录入/导出 | 管理/搜索 | 报表 | 配置/用户 |
|------|:----:|:----:|:----:|:---------:|:---------:|:----:|:---------:|
| `clerk` | ✔ | ✔ | ✘ | ✔ | 查看本人 | ✘ | ✘ |
| `finance` | ✔ | ✔ | 可授予 | ✔ | ✔ | 可授予 | ✘ |
| `warehouse` | ✔ | ✔ | 可授予 | ✔ | 查看本人 | 可授予 | ✘ |
| `reviewer` | ✘ | ✘ | ✔ | ✘ | 查看已分配项 | 可授予 | ✘ |
| `viewer` | ✘ | ✘ | ✘ | ✘ | 查看 | 可授予 | ✘ |
| `admin` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

> 权限按角色累加；一名用户可拥有多个角色。`review` 与 `report_view` 为可配置权限。默认 V1.0 角色：`clerk`、`finance`、`reviewer`、`admin`。
>
> 游客会话不是 RBAC 角色：仅可访问本人上传、识别、核验草稿与试用导出，不可 confirm:true 或访问管理、报表/配置；显式登录后正式用户认领其数据，游客会话随即失效。未注册正式用户仍须完成注册才可确认。

## 4. 规则
- **密码：** 使用强单向哈希（例如 bcrypt/argon2）存储；绝不存储明文（见 `NFR-SEC`）。
- **登录环境边界（FR-SYS-001）：** 线上仅通过真实 LINE 联合认证；Developer sign-in 仅用于本地开发，不是生产登录方式，也不是 LINE 不可用时的替代方案。
  - 开发入口仅在 `import.meta.env.DEV` 为真且 `VITE_AUTO_DEV_LOGIN` 为 `true` 时显示；生产构建即使配置 `VITE_AUTO_DEV_LOGIN=true` 也不显示。移除 `VITE_DEV_BYPASS`。所有环境的 `Login/Register with LINE` 按钮仅走真实 LINE OAuth/LIFF 流程，永不以 `dev_id` 或模拟 LINE 身份替代。
  - 后端默认 `APP_ENV=production`、`AUTH_DEV_MODE=false`；仅 `APP_ENV=development` 且显式 `AUTH_DEV_MODE=true` 且未检测到 Cloud Run 的 `K_SERVICE` 时允许 dev 认证。仅开启 `AUTH_DEV_MODE` 不足以启用开发认证；Cloud Run 即使误配开发开关也不得允许 dev。
  - 不满足上述本地条件时，认证请求含 `dev_id`（即使同时携带有效 LINE `id_token`）须在任何数据库访问前返回 `400 INVALID_ARGUMENT`，消息键 `auth.id_token_required`；不得查找或创建用户、创建会话、配额或业务数据，也不得触发游客数据归集。
  - 生产环境中的旧 `dev:` 身份会话视为无效，不能访问鉴权 API；保留其历史用户及业务数据，不批量清理或迁移。明确启用的本地开发仍可使用这些 dev 身份与未过期、未撤销的旧会话。
  - 真实 LINE `id_token` 必须由服务端验证 issuer（`iss`）、audience（`aud`，匹配配置的 LINE Channel ID）与 expiry（`exp`）；验证失败、LINE 不可用或配置缺失时拒绝认证，不回退至开发登录。
  - 认证环境、资料与 TLS SMTP 安全边界沿用以上及下文规则；本轮调整启动/退出、结果页认证触发与默认个人权益，不改变 FR-SYS-016 换邮箱业务规则或登录刷新与注册之间的行锁/重读保护。
  - 启动仅恢复有效应用 Cookie 或建立游客会话进入主壳（包括已认证但未注册者），绝不自动以残留 LIFF token 创建应用登录；只有显式 LINE 按钮登录意图及其 OAuth 回跳可兑换 token。运行中试用界面的 401 清理失效应用身份并恢复游客首页；auth 窗口中的 401 保留可重试入口，不自动 LINE 登录。
  - LIFF 初始化等待上限为 20 秒，错误仅区分初始化失败、SDK 会话读取失败、超时，不暴露原始异常、token 或 URL。只有用户显式点击 LINE 按钮后，失败才可从无查询参数的官方 `https://liff.line.me/<LIFF ID>` 重开一次；重开前不删除非凭据登录意图和待续任务，同一 sessionStorage 上下文重复失败停止跳转并引导关闭窗口后从 LINE 重开。存储不可用或 LIFF 未配置时不重开、不回退开发身份。初始化成功清重开标记；超时后的迟到完成不复活初始化缓存。返回或卸载登录页使仍在等待 SDK 的请求失效，不兑换迟到 token、不跳 OAuth/恢复入口；已发出的认证请求不保证可撤回，但取消后不自动导航或确认结果。真实手机换 WebView 时的存储连续性须单独验收，不以桌面模拟替代。
  - 2026-10-28 验证/发布：16 项恢复/取消源码检查、25 项冻结构建浏览器及 6 项真实认证源码模块模拟通过。旧前端 `workspaces` 与新 API `tenants` 不匹配造成认证 200 后显示 Sign-in failed；已发布 `index-Dq5WLJaK.js` 并明确切换前端流量，7 个真实域名静态文件哈希一致，详见 [Architecture §5](../../30-design/Architecture.md#5-部署模型)。未改动用户账号或业务数据，真实手机完整登录仍需用户验收。
- **登出（FR-SYS-001）：** 个人中心点击 `Sign out` 先弹确认框，取消保持登录。确认后须先在 `localStorage` 建立非凭据 `logout-pending` 标记，再调用 10 秒超时的 `POST /api/v1/auth/logout` 撤销旧会话/应用 Cookie；清身份、当前租户、CSRF 与待续意图，最佳努力清 LIFF SDK 状态。撤销成功后清标记、建立游客会话并返回游客 `scan` 首页，不停留在旧 `My` 页。失败或 10 秒超时保留标记、锁定主壳并提示重试，不得复用正式 Cookie；用户点击 `Back` 重试或刷新时，均先 `session`（CSRF-only，仅取得撤销所需 CSRF，不恢复旧身份）→`logout` 撤销旧会话→成功后 `guest`，清标记并返回游客 `scan` 首页，成功前主壳保持锁定，全程不自动 LINE 兑换。此操作不同于取消登录/注册。
- **操作日志（FR-SYS-003）：** 仅可追加；采集 `user`、`action`、`target`、`timestamp`、`result`。用于可追溯性和防篡改证据。
- **语言（FR-SYS-004）：** 默认 = 泰语；切换立即生效且无需重启；所有面向用户的字符串均外部化（i18n 资源包）。
- **配置（FR-SYS-005/006）：** 变更需要 `admin`；变更会被记录。
- **品牌等待（横切规则）：** LINE Mini App 的启动、页面、局部请求与按钮等待继承 [NFR-USAB-004](../non-functional/NFR.md)，设计见 [Architecture §3.1](../../30-design/Architecture.md#31-line-mini-app-品牌等待设计)；不改变既有请求、认证、套餐分流或确认规则，订阅申请处理中（`pending`）不视为网络加载，验收沿用汇总标准，不新增 FR 或重复 AC。
- **游客试用（FR-SYS-010）：** 匿名访客首次进入应用时创建游客会话，并为其创建个人租户、幂等开通一个月默认 Kinder 订阅，可使用上传、识别与核验；游客数据仅本人可见。登录或注册成功后，游客名下的全部数据（文档、识别任务、结果版本、导出记录、通知、审计与申请）按 `tenant_id` 归集至正式账户的个人租户，并在同一事务内删除游客账户及其会话、验证码、头像对象、游客租户上的订阅行与到期提醒记录；游客提交过的 `applications.target_tenant_id` 改指向正式账户的个人租户，记录审计 `guest.claim`。游客不接收到期提醒。
- **确认前认证（FR-SYS-011）：** 仅结果核验页 `Continue` 在确认前检查认证与注册状态；首页、上传和开始 OCR 不触发登录/注册框。游客有 dirty 结构化变更时先 PATCH `confirm: false` 保存，无变更不保存，然后进入 `auth` 登录；已认证但未注册者同样进入 `auth` 并显示注册框，均不提交 `confirm: true`，不跳 `plans`。
  - `pendingAuth`（显式登录意图）与 `pendingJob`（任务续接上下文）分开；`sessionStorage` 只存非凭据上下文，禁止保存 LINE token、应用 Cookie 或 CSRF。认证成功但仍需注册时保留任务上下文；完成注册并成功导航后才清任务。保存、认证、注册或恢复异常时保留可重试上下文，不误跳 `plans`。
  - 取消登录/注册返回原结果页，保留已归集任务的访问权限，不撤销 LINE/应用会话，不自动续接或确认；清显式 `pendingAuth` 与自动续接的 `pendingJob` 标记（服务端任务与草稿仍保留，用户可在原结果页手动继续）。取消不等于退出。
  - 认证与注册成功、游客数据归集后重新读取任务，未完成任务仅回 `result`；只有原已 `COMPLETED` 可回 `final`。不会直接进入订阅页或自动 `confirm`；企业未认证（`NONE`）或订阅已到期（`EXPIRED`）的分流只在用户随后显式 Continue 时执行。
  - 服务端所有 `confirm: true` 路径必须强制 `_registered`：guest 返回 401，已认证未注册返回 `403 PERMISSION_DENIED` / `registration.required`，拒绝须发生在写入结果版本、改变当前版本标记或完成状态之前。`confirm: false` 仍可试用，保留既有任务权限与核验校验。
- **归属只有 `tenant_id`（FR-SYS-012/017）：** 不再有 `workspace_type` + `enterprise_id` 组合。个人用户（含游客）与每家企业各对应一行 `tenants`（`tenant_type` = `PERSONAL` / `ENTERPRISE`），`enterprises` 通过 `enterprises.tenant_id` 作为企业租户的 1:1 扩展；文件、识别任务、成员关系、邀请、申请与订阅都只带一个 `tenant_id`。请求省略或传空 `tenant_id` 即调用者本人的个人租户。为不改动前端文案，错误沿用旧 message_key：
  - `tenant_id` 无法解析为整数、租户不存在或类型不符 → `400 INVALID_ARGUMENT` / `error.invalid_workspace`；
  - 指向他人的个人租户 → `403 PERMISSION_DENIED`；本人个人租户非 `ACTIVE` → `403 ACCOUNT_DISABLED`；
  - 成员关系非 `ACTIVE`、企业非 `VERIFIED` 或租户非 `ACTIVE` → `403 ENTERPRISE_ACCESS_REVOKED` / `error.enterprise_access_revoked`。
- **默认开通与到期硬停（FR-SYS-012）：** 每个租户在 `subscriptions` 中最多一行（`tenant_id` 唯一约束即幂等保证）。
  - 个人租户（含游客）在首次登录/建立游客会话时自 `tenants.created_at` 起开通一个月 `KINDER`，`source=DEFAULT`。企业租户在 `enterprises.status` 首次被读到为 `VERIFIED` 时由服务端补填 `verified_at`，并自该时刻起开通一个月 `KINDER`；未认证企业没有订阅行，订阅状态为 `NONE`。
  - 有效期按自然月推进并做月末夹取：2026-01-31 + 1 个月 = 2026-02-28。`days_remaining` 按泰国时区（UTC+7）日历日计算，`0` = 当天到期，负数 = 已过期。
  - 到期即硬停，没有 Free 档位或赠送次数兜底：`expires_at` 之后新建或重跑识别任务返回 `402 PAYMENT_REQUIRED` / `PLAN_EXPIRED` / `plan.expired`；查询历史任务、结果与导出不受影响。
  - 续费与升级完全线下：`PLAN_UPGRADE` 申请（`applications`，`target_tenant_id` 指向目标租户，`form` 含 `plan_code`、`plan_name`、`tenant_id`、`tenant_type`、`valid_from`、`valid_to`）由运营审批；批准后写入有效期（也可用 `period_months`，1~120，缺省 12），读取订阅时据 `application_id` **惰性同步且同一申请只生效一次**。未指定 `valid_from` 时新周期自 `max(now, 当前 expires_at)` 起算，即未到期时顺延而非截断。
  - 申请约束：存在处理中（`SUBMITTED` / `UNDER_REVIEW` / `NEEDS_INFO`）申请时再提交返回 `409 STATE_CONFLICT` / `plan.application_pending`；订阅为 `ACTIVE` 时目标档位低于当前档位返回 `409 STATE_CONFLICT` / `plan.not_upgrade`，**同档续费允许**；订阅为 `EXPIRED` 或 `NONE` 时任意档位均可申请。企业租户仅 `OWNER` 可提交（否则 `403 PERMISSION_DENIED` / `plan.enterprise_owner_only`），游客提交返回 `401`。
- **确认前订阅分流（FR-SYS-012）：** 按**任务所属租户**取得订阅状态，而非其他租户。`ACTIVE`（`DEFAULT` 或 `APPROVED`，含另有独立 `pending` 申请）允许已注册用户在结果页显式 Continue，经核验校验后提交 `confirm: true`；成功后才锁定结果、记录 `completed_at` 并进入 `final`。
  - `NONE`（企业未认证）或 `EXPIRED`：不确认，进入 `plans`，默认选中 `Kinder`；已有处理中申请时进入 `plan-pending` 显示申请与时间，可返回首页。游客或未注册者优先按 FR-SYS-011 进入 `auth`，不能用 `NONE`/`EXPIRED` 替代注册门禁。
  - 重定向前仅 dirty 内容以 PATCH `confirm: false` 保存；无变更不保存，不锁定、不记录 `completed_at`（FR-VERIFY-015/016）。保存失败不得继续重定向。
  - 登录/注册或套餐恢复不自动确认；未完成 `VERIFYING` 或 legacy `VERIFIED` 返回 `result`，只有原已 `COMPLETED` 可 `final`。历史 `VERIFIED` 保留兼容，不批量转换，已注册且任务所属租户订阅为 `ACTIVE`（含默认 Kinder）的用户可显式继续完成。
  - 提交申请后提示“您的申请已经收到，我们会尽快联系您”，确认提示返回首页，不等于核验确认；提交记录审计 `plan_application.submit` 与站内通知 `PLAN_UPGRADE_SUBMITTED`。
- **套餐展示与月页计量（FR-SYS-013）：** 唯一计量单位为 `OCR_PAGE`（`plan.metering` 恒为 `OCR_PAGE`）；不存在 FREE 档位、赠送任务额度（原首登 1,000 次与企业认证 1,000 次均已取消）与额度流水表。
  - 月页用量按泰国时区（`Asia/Bangkok`）自然月实时统计该租户 `ocr_jobs.page_count` 之和，`FAILED` 与 `CANCELLED` 的任务不计——因此取消任务天然不计入，没有返还步骤。各档每月页数：Kinder 1,000 / Starter 5,000 / Intermediate 10,000 / Advance 100,000。
  - 展示 “套餐名 · 剩余 / 每月页数 pages left this month”，不显示 Free 或 Sign-in bonus；`is_paid=false`（默认 Kinder）不代表无权益。订阅非 `ACTIVE` 时剩余页数按 0 展示。
  - 新建或重跑识别任务时先判订阅再判页数：非 `ACTIVE` → `402 PLAN_EXPIRED` / `plan.expired`；`ACTIVE` 但本月页数已用尽 → `402 QUOTA_EXCEEDED` / `quota.exceeded`。字段语义见 Data-Model §2.13.1。
  - 企业成员仅有两种角色：所有者 `OWNER` 与普通成员 `MEMBER`。企业租户的套餐申请仅 `OWNER` 可提交；`MEMBER` 可查看企业当前套餐与处理中申请，套餐页显示“仅公司所有者可申请升级”提示，升级按钮不可用，服务端拒绝其提交（`403 PERMISSION_DENIED`，`plan.enterprise_owner_only`）。
  - 套餐页（已登录）：当前套餐标记“Current plan”；可申请的档位显示 `Upgrade`，点击即提交升级申请，提示“您的申请已经收到，我们会尽快联系您”，确认后返回首页；订阅 `ACTIVE` 时更低档位不提供操作；有处理中申请时该套餐显示 `Upgrade in progress` 并以橙色描边与 `IN REVIEW` 角标突出，其他升级按钮禁用；页面最顶部（当前套餐卡之上）显示醒目的橙色处理中卡片（图标、标题 `Upgrade to {套餐名} in progress`、销售联系说明与提交时间）。
  - 档位顺序 `Kinder < Starter < Intermediate < Advance`；订阅 `ACTIVE` 时降档申请被拒（`409 STATE_CONFLICT`，`plan.not_upgrade`），同档续费允许；`EXPIRED` / `NONE` 时任意档位可申请。后台批准后按写入的有效期切换。
  - 提交任一套餐申请（订阅计划检查页的 `Upgrade to {套餐名}` 或套餐页的 `Upgrade`）前，必须先弹出确认框（显示目标套餐，可取消）；取消不产生申请，确认后才提交。
  - `GET /api/v1/plans` 只返回目录，不接受 `tenant_id`；租户维度的订阅与页数分别由 `GET /api/v1/me/subscription?tenant_id` 与 `GET /api/v1/me/quota` 返回。未登录（游客）首页不显示套餐横幅；游客的套餐页不显示当前套餐卡，套餐按钮仅为线下联系说明且不可提交。
- **到期提醒与通知中心（FR-SYS-018）：** 提醒节点为 `D7` / `D3` / `D1` / `D0` / `EXPIRED`（到期前 7/3/1 天、到期当天、已到期），按泰国时区日历日判定。
  - 幂等：`plan_reminders` 以 `(tenant_id, period_end, stage)` 唯一约束作为幂等键，同一周期同一节点只发一次；续费后 `period_end` 变化，新周期重新按节点提醒。只在命中节点的当天写入，**不回补**已错过的节点（例如 D5 当天扫描不补发 D7）。
  - 投递：站内通知先落库提交（类型 `PLAN_EXPIRING` 用于 D7/D3/D1/D0，`PLAN_EXPIRED` 用于到期后），随后尽力发送邮件，邮件结果只回写 `plan_reminders.email_sent`，发信失败不影响站内通知。仅对有邮箱且已完成注册的用户发邮件；游客不产生提醒。
  - 收件人：个人租户为其所属用户；企业租户为 `ACTIVE` 的 `OWNER`，若没有 `OWNER` 则取最早的 `ACTIVE` 成员兜底。
  - 执行位置：由 OCR worker 进程内的低频扫描驱动（约每 30 分钟检查一次，每个泰国日历日只扫一次），受 `PLAN_REMINDERS_ENABLED` 开关控制；不额外部署调度服务，也不提供运营界面或 SLA 承诺。
  - 通知中心：`GET /api/v1/me/notifications` 返回 `{"unread_count": n, "items": [...]}`；`POST /api/v1/me/notifications/read` 以 `{"ids": [整数,...]}` 将指定通知标记已读，`ids` 为空数组或省略表示全部标记，重复调用幂等，只影响本人的未读行，返回 `{"updated": n, "unread_count": n}`。`ids` 不是数组或含非整数（含布尔值）元素时返回 `400 INVALID_ARGUMENT` 且 `field_errors` 指向 `ids`。
- **LINE 注册信息录入（FR-SYS-014）：** 线上注册仅通过真实 LINE 联合认证完成；本地模拟身份仅来自 FR-SYS-001 规定的独立 Developer sign-in。注册框只在 `route=auth` 且 `needsRegistration`（已认证非 guest、`users.registered_at` 为空）时显示；启动与进入主壳、首页、上传和开始 OCR 均不强制注册。结果 Continue 按 FR-SYS-011 进入 auth 后才弹注册框：
  - 手机号（可选）：默认使用服务端验证的 LINE 返回值（若提供 `phone_number`）；注册时可编辑并保存用户提交的值。LINE 不保证提供手机号，未提供时可手填，也可留空；不得将手机号设为必填。注册后仍可在个人中心修改（FR-SYS-015）。
  - 邮箱（必填）：默认使用服务端按 FR-SYS-001 验证后的 LINE `id_token` 中的 `email` 声明，不信任客户端自行声明的 LINE 邮箱。获取邮箱需渠道启用 `email` scope 并取得用户授权；未提供时由用户手填，预填值可编辑。须点击「发送验证码」，由服务端通过 TLS SMTP 向当前填写的邮箱实际发送 6 位数字验证码（复用 FR-SYS-016 的 `POST /api/v1/me/email/code`，10 分钟有效，60 秒内重发返回 `429`；未注册时允许向当前邮箱发送），输入验证码后才可提交；修改邮箱后须重新发送。
  - 注册验证码仅在 SMTP 发送成功后记录为有效新码，成功重发后旧码失效；校验须匹配当前用户与当前邮箱，错误、过期或已使用的码均拒绝（`error.email_code_invalid`），不完成注册。发信未配置或 TLS、认证、超时等发送失败时返回 `503 EMAIL_SERVICE_UNAVAILABLE`，不记录有效新码、不完成注册（`users.registered_at` 保持为空）。仅按 FR-SYS-001 明确启用的本地开发沿用不实际发信、不校验验证码的既有例外。
  - 昵称（必填，≤128 字符）与头像：默认取自 LINE，可修改；头像在客户端居中裁剪为 256px JPEG 后上传，服务端仅接受 https URL 或 ≤300KB 的 png/jpeg/webp data URL（声明类型须与文件头一致）。
  - 头像存储：上传的头像图片保存至 Firebase Storage（私有桶，对象名 `avatars/<user_id>/<随机名>.<ext>`），`users` 表只保存对象名，不保存图片数据；替换或清空头像后删除旧对象。前端经 `GET /api/v1/me/avatar`（会话鉴权的后端代理，不生成匿名或签名 URL）读取。LINE 提供的 https 头像 URL 仅作引用保存，不转存。上传失败返回 `503 STORAGE_UNAVAILABLE`（`avatar.upload_failed`）。
  - 提交 `POST /api/v1/me/registration` 并通过校验后保存手机号、邮箱及其他资料、消费验证码、完成注册；个人租户的一个月默认 Kinder 在首次登录时就已开通，注册不再额外发放权益；按 FR-SYS-011 仅回 result（原已 COMPLETED 可 final），不自动确认或跳订阅页。取消返回原结果且保留已归集任务权限与 LINE/应用会话，清显式登录意图、不自动续接；任务上下文清理见 FR-SYS-011。重复提交返回 `409 STATE_CONFLICT`（`registration.already_done`）。提交记录审计 `user.register`。
  - 已注册用户再次 LINE 登录时，不再用 LINE 资料覆盖用户保存的手机号、邮箱、昵称与头像。功能上线前已存在的正式账号视为已注册。
  - 本地开发（仅按 FR-SYS-001 明确启用时）：通过独立 Developer sign-in 模拟 dev 身份，LINE 资料（手机号、邮箱、昵称、头像）随机生成，约 1/3 概率不带邮箱以覆盖必填录入；模拟资料不得由 `Login/Register with LINE` 按钮触发。生产不允许模拟身份注册，也不因 LINE 不可用而开放 dev 入口。
- **资料修改（FR-SYS-015）：** 个人中心资料卡可点击，弹框修改昵称、头像与手机号（`PATCH /api/v1/me`，字段白名单 `display_name`/`phone`/`language`/`avatar_url`）。手机号可修改也可清空（传空串即清空）；校验规则：长度 ≤ 32，只允许 `+`、数字、空格、`(`、`)`、`.`、`-`，剔除非数字后须为 6–15 位数字；不合法返回 `400 INVALID_ARGUMENT` 且 `field_errors = [{field: "phone", message_key: "error.phone_invalid"}]`。游客不可修改手机号或头像（`403 PERMISSION_DENIED`）。修改记录审计 `me.update`。
- **更换邮箱（FR-SYS-016）：** 个人中心邮箱行点击「更换」，录入新邮箱后点击「发送验证码」（`POST /api/v1/me/email/code`，6 位数字，10 分钟有效，60 秒内不可重发 → `429`），再输入验证码确认（`POST /api/v1/me/email`）。新邮箱不得与当前邮箱相同；须先向该新邮箱发送过验证码才可确认。
  - 生产环境需配置发信服务，未配置时发送接口返回 `503 EMAIL_SERVICE_UNAVAILABLE`，验证码须匹配且未过期、未使用（`error.email_code_invalid`）；不存在临时生产 dev 例外。
  - 仅按 FR-SYS-001 明确启用的本地开发不实际发信（只模拟发送结果，不记录明文验证码），确认时不校验验证码；单独设置 `AUTH_DEV_MODE=true` 不得放宽生产规则。
  - 发送与更换均记录审计（`me.email_code`、`me.email_change`）。
- **实现与验证边界（FR-SYS-001/010..014）：** 2026-10-27 启动/认证、退出防复登与注册门禁已真实实现并正式发布，不再仅为文档契约或待验证目标。本轮 334 项隔离后端回归、最终生产构建 `index-BUTDgRGj.js` 的 21 项全 mock 浏览器场景、6 项 OAuth 源码模块模拟与 9 项前端会话边界测试均通过；类型检查、Vite 构建及 OpenAPI 283 个内部引用校验通过。当时默认 Kinder 由既有 `registered_at` 动态推导（该推导已于 2026-10-28 改为 `subscriptions` 持久化行，见 FR-SYS-012）。正式发布、生产只读核验与单次日志审查详见 [Architecture §5](../../30-design/Architecture.md#5-部署模型) / [§6](../../30-design/Architecture.md#6-安全性与可靠性) 的本轮记录；单次日志结果不是长期保证。
  - **本轮隔离与未验证边界：** 隔离测试从未连接数据库、真实 LINE 或 SMTP，也未创建生产账户记录；本轮未发送真实测试邮件，SMTP 模块与 Secret Manager 版本引用未改变，Cloud SQL `postgres.saiflow` 亦未改变。不宣称真实 LINE OAuth/完整注册、收件箱收件、真实数据库并发或验证码防猜码已验证。phone/email、TLS SMTP、锁后重读与换邮箱规则不变（个人中心手机号只读的旧约束已于 2026-10-28 作废，见 FR-SYS-015）。
  - **历史注册/SMTP 证据（1.6.6/1.6.7，仅保留，不覆盖本轮）：** 注册资料与标准库 SMTP 代码及 221 项隔离后端测试、5 项模拟浏览器测试、前端类型检查/构建、OpenAPI YAML 校验曾通过；包含登录刷新与注册的锁后重读。发件人为 `fj168104@gmail.com`，Gmail 应用专用密码仅 Secret Manager 注入 `MAIL_SMTP_PASSWORD`，配置及历史发布记录见 [Architecture §6](../../30-design/Architecture.md#6-安全性与可靠性)，不记录任何凭据。历史本地/Cloud Run 向发件邮箱自身实发获 SMTP 确认接收，未独立检查收件箱、真实 LINE 注册或真实数据库并发；隔离测试/SMTP 接收不等于全流程验收。已收到 LINE Channel ID `2011688528` 与 LIFF ID `2011688528-9VP8cr3o`，真实联调仍需配置核验与用户授权。这些历史测试、SMTP 自测与发布不是本轮证据；1.6.4 临时生产 dev 例外已撤销，只保留历史。
- **租户切换与隔离（FR-SYS-017）：** 可选租户 = 本人个人租户 + 本人为 `ACTIVE` 成员且企业为 `VERIFIED` 的企业租户（`GET /api/v1/me/tenants` 返回 `{tenant_id, tenant_type, name, role}`）；在首页身份 chip 或个人中心切换。
  - 保持：所选租户按用户记忆在本机（`localStorage`，仅存 `tenant_id`），刷新或重新登录后恢复；若该企业已解绑、成员资格失效或企业不再为 `VERIFIED`，回落本人个人租户。
  - 数据隔离：首页最近任务与历史页仅列出当前租户的任务（`GET /api/v1/ocr/jobs?tenant_id=…`，省略即本人个人租户），切换后立即刷新；个人租户仅含本人的个人任务，不出现企业任务，反之亦然。上传与 URL 导入的文件归属请求中的 `tenant_id`，其后的任务与结果随文件归属（任务的 `tenant_id` 继承源文件）。
  - 企业共享：企业租户的文件、任务与结果对该企业全体 `ACTIVE` 成员可见；企业订阅与月页额度由全体成员共享并合并计量（见 FR-SYS-013）。
  - 各租户的订阅与月页用量分别计量，互不抵扣。

## 5. 代表性验收标准

> 以下“开发环境”仅指 FR-SYS-001 明确启用的本地开发。退出、仅结果 Continue 触发认证/注册、取消续接与服务端注册门禁已实现、通过 2026-10-27 的隔离验证并正式发布，代表性/汇总 AC 已同步；334/21/6/9 项验证、类型检查/Vite 构建及 OpenAPI 283 个内部引用证据和隔离边界见 §4。2026-10-27 本轮正式发布引用 [Architecture §5](../../30-design/Architecture.md#5-部署模型) / [§6](../../30-design/Architecture.md#6-安全性与可靠性)，不以历史 221/5 项测试或 SMTP 自测替代本轮证据；不宣称真实 LINE OAuth、收件箱/完整注册、真实数据库并发或验证码防猜码已验证。2026-10-28 的租户归属、一个月默认订阅与到期硬停、到期提醒、通知标记已读与手机号可编辑（FR-SYS-012/013/015/017/018）为后端已实现的契约同步，本次文档更新未运行任何测试。

```gherkin
Feature: EPIC-06 基础系统

  Scenario: AC-FR-SYS-001-01 登录成功
    Given 已注册且具有有效凭据的用户
    When 用户登录
    Then 系统 SHALL 创建会话并授予该用户的角色权限

  Scenario: AC-FR-SYS-001-03 退出确认、超时与刷新防复登
    Given 已登录用户在个人中心
    When 用户点击 "Sign out" 后取消确认
    Then 用户保持登录，不写 logout-pending、不撤销会话
    When 用户再次点击 "Sign out" 并确认
    Then 先在 localStorage 写非凭据 logout-pending，再以 10 秒超时的请求撤销旧应用 Cookie/会话
    And 清身份、当前租户、CSRF 与待续意图，最佳努力清 LIFF SDK 状态
    When 撤销成功
    Then 清标记、建立游客会话并返回游客 scan 首页，不停留在旧 My 页，不因残留 LIFF token 静默复登
    Given 撤销失败或达到 10 秒超时，浏览器可能仍有正式 Cookie
    Then 保留标记、锁定主壳并提示重试，不复用正式 Cookie 或旧身份
    When 用户点击 "Back" 重试或刷新页面
    Then 先 session CSRF-only 仅取得撤销所需 CSRF，不恢复旧身份，再 logout 撤销旧会话，成功后才 guest 建立游客会话
    And 成功后清标记并返回游客 scan 首页，不停留在旧 My 页；成功前主壳保持锁定，全程不自动 LINE 兑换

  Scenario: AC-FR-SYS-001-04 生产无开发入口且 LINE 按钮仅走真实认证
    Given 前端为生产构建（import.meta.env.DEV=false），包括 VITE_AUTO_DEV_LOGIN=true 的误配置
    When 用户打开登录或注册页
    Then 不显示 Developer sign-in 或其他开发身份入口
    Given 任一环境，包括已明确启用开发入口的本地环境
    When 用户点击 "Login/Register with LINE"
    Then 仅进入真实 LINE OAuth/LIFF 流程，不发送 dev_id、不生成模拟 LINE 身份

  Scenario: AC-FR-SYS-001-05 生产拒绝 dev 请求与旧会话且不回退
    Given 后端为生产环境，包括 APP_ENV/AUTH_DEV_MODE 均未配置的默认情况
    When 向认证接口提交 dev_id，分别不带 id_token 和同时携带有效 LINE id_token
    Then 在任何数据库访问前返回 400 INVALID_ARGUMENT，消息键 auth.id_token_required
    And 不创建用户、会话、配额或业务数据，不触发游客数据归集
    Given 生产环境中保留了旧 dev: 身份及其未过期、未撤销的会话
    When 使用该旧会话访问鉴权 API
    Then 会话视为无效，拒绝访问，历史用户及业务数据保留，不批量清理或迁移
    Given 用户通过真实 LINE 流程取得 id_token
    When 服务端处理 LINE 认证
    Then 服务端验证 issuer（iss）、audience（aud，匹配配置的 LINE Channel ID）和 expiry（exp）
    And 验证失败、LINE 不可用或配置缺失时拒绝认证，不回退至 dev 登录
    And 认证失败不创建用户、会话、配额或业务数据，不触发游客数据归集

  Scenario: AC-FR-SYS-001-06 本地显式启用可开发登录且生产开关不能绕过
    Given 本地前端 import.meta.env.DEV=true 且 VITE_AUTO_DEV_LOGIN=true
    And 本地后端 APP_ENV=development 且显式 AUTH_DEV_MODE=true，未检测到 K_SERVICE
    When 用户通过独立 Developer sign-in 提交 dev_id
    Then 允许开发身份登录，注册框仍仅在 auth 且 needsRegistration 时显示，不在主壳强制注册
    And 本地旧 dev: 身份及未过期、未撤销的旧会话仍可使用
    Given 本地前端 VITE_AUTO_DEV_LOGIN 未配置或不为 true
    When 用户打开登录或注册页
    Then 不显示开发身份入口，LINE 按钮仍仅走真实 OAuth/LIFF
    Given 后端仅设置 AUTH_DEV_MODE=true，但 APP_ENV 未配置、为 production 或其他非 development 值
    When 向认证接口提交 dev_id（包括同时携带有效 LINE id_token）
    Then 在任何数据库访问前返回 400 INVALID_ARGUMENT，消息键 auth.id_token_required，不创建用户、会话、配额或业务数据
    Given APP_ENV=development 但 AUTH_DEV_MODE 未配置或为 false，或两个开发开关均开启但检测到 Cloud Run K_SERVICE
    When 向认证接口提交 dev_id（包括同时携带有效 LINE id_token）
    Then 同样在任何数据库访问前拒绝认证（400 INVALID_ARGUMENT，auth.id_token_required），不创建用户、会话、配额或业务数据

  Scenario: AC-FR-SYS-001-07 LIFF 初始化有界恢复与取消
    Given LIFF 初始化失败、会话读取失败或等待达到 20 秒
    Then 只有显式 LINE 按钮可从无查询参数的官方 LIFF 入口重开一次，重开前保留非凭据意图与待续任务
    And 同一 sessionStorage 上下文重复失败、存储不可用或缺配置时停止跳转，不回退 dev
    When 用户在 SDK 完成前返回或登录页卸载
    Then 迟到成功、失败或超时均不兑换身份、不跳转、不自动导航或确认任务
    And 超时后的迟到成功不复活初始化缓存；真实手机存储连续性须另验，完整条件见汇总 AC

  Scenario: AC-FR-SYS-002-01 权限强制执行
    Given 角色为 "viewer" 的用户
    When 用户尝试导出
    Then 操作被拒绝（403）并记录

  Scenario: AC-FR-SYS-004-01 语言切换
    Given UI 当前为泰语
    When 用户将语言切换为英语
    Then 所有 UI 标签更新为英语，且无需重启应用

  Scenario: AC-FR-SYS-010-01 Cookie 或游客启动，不隐式 LINE 登录或强制注册
    Given 浏览器存在残留 LIFF token，但没有显式 LINE 登录意图或对应 OAuth 回跳
    When 启动应用
    Then 仅恢复有效应用 Cookie 或创建游客会话进入主壳，不自动兑换残留 token
    And 已认证未注册者也可进入主壳，首页、上传与开始 OCR 不弹登录/注册框
    When 游客上传、识别并编辑核验草稿
    Then 仅能访问自己的任务与结果，不获得管理、报表或配置权限
    Given 用户显式点击 LINE 按钮或返回该次 OAuth 授权
    Then 才可兑换真实 token，不以 SDK 登录态冒充应用登录
    Given 运行中试用界面返回 401
    Then 清理失效应用身份并恢复游客首页，不自动 LINE
    Given auth 窗口中的请求返回 401
    Then 保留可重试认证入口，不自动 LINE

  Scenario: AC-FR-SYS-010-02 游客数据归集
    Given 游客已完成上传与识别
    When 游客登录或注册为正式用户
    Then 其文档、任务、结果版本与导出记录按 tenant_id 归集至该正式用户的个人租户
    And 游客账户、会话、游客租户上的订阅行与到期提醒记录被删除，游客提交过的申请改指向正式用户的个人租户

  Scenario: AC-FR-SYS-011-01 仅结果 Continue 触发 auth，续接取消与异常
    Given 用户为游客或已认证未注册，任务尚未最终完成
    When 用户在结果核验页点击 "Continue"
    Then 仅 dirty 时先 PATCH confirm:false 保存，无变更不保存，随后进入 auth，不跳 plans、不提交 confirm:true
    And 仅 route=auth 且 needsRegistration 显示注册框，已认证未注册者直接弹注册
    And pendingAuth 与 pendingJob 分开，sessionStorage 只存非凭据上下文，不存 token、Cookie 或 CSRF
    When 认证成功但仍需注册
    Then 保留 pendingJob 供注册，不提前清任务上下文
    When 完成注册且导航成功
    Then 重新读取任务，未完成仅回 result、原已 COMPLETED 可 final，之后才清 pendingJob，不自动 confirm 或跳订阅页
    Given 保存、认证、注册或恢复发生异常
    Then 保留可重试上下文，保存失败不重定向，不误跳 plans
    Given 登录/注册已打开且游客任务可能已归集
    When 用户取消登录或注册
    Then 清显式 pendingAuth 与 pendingJob 续接标记，回原 result，保留已归集任务权限和 LINE/应用会话
    And pendingJob 仅供手动续接，不自动恢复或确认

  Scenario: AC-FR-SYS-011-02 服务端确认注册门禁无写入副作用
    Given 请求者分别为 guest 和已认证但 registered_at 为空的用户，具有自己的试用任务
    When 直接提交 confirm:true，包括携带结构化改动或针对 legacy VERIFIED
    Then guest 返回 401，未注册返回 403 PERMISSION_DENIED / registration.required
    And 在写结果版本、切换 is_current 或写完成状态前拒绝，版本与 completed_at 不变
    When 提交有效 confirm:false 草稿
    Then 仍可按原任务权限保存，不要求注册、不锁定或完成任务

  Scenario: AC-FR-SYS-012-01 个人与游客租户默认开通一个月 Kinder
    Given 用户首次 LINE 登录或匿名访客首次进入应用
    When 服务端建立其个人租户
    Then 订阅为 ACTIVE / KINDER / source=DEFAULT / application_id=null，starts_at 等于 tenants.created_at
    And expires_at 为 starts_at 往后一个自然月，days_remaining 按泰国时区日历日计算
    When 同一用户重复登录
    Then 订阅行不被重置或重复创建（tenant_id 唯一），starts_at 与 expires_at 保持不变
    And 已注册用户在结果页显式 Continue 并通过核验时允许 confirm:true，成功才锁定、记录 completed_at 并进 final

  Scenario: AC-FR-SYS-012-02 企业自认证时起算，未认证为 NONE
    Given 某企业提交认证但尚未通过，用户是其成员
    When 读取该企业租户的订阅
    Then status=NONE，plan_code / starts_at / expires_at / days_remaining 均为 null
    When 该企业租户下新建识别任务
    Then 返回 402 PAYMENT_REQUIRED / PLAN_EXPIRED / plan.expired
    When 运营将企业状态改为 VERIFIED，服务端首次读到该状态
    Then 补填 enterprises.verified_at，并自该时刻起开通一个月 KINDER（source=DEFAULT）
    And 该企业全体 ACTIVE 成员共享同一订阅与月页额度

  Scenario: AC-FR-SYS-012-03 到期硬停但历史可读
    Given 某租户订阅的 expires_at 已过
    When 读取订阅
    Then status=EXPIRED，days_remaining 为负数
    When 在该租户下新建或重跑识别任务
    Then 返回 402 PLAN_EXPIRED / plan.expired，不创建任务
    When 查看历史任务列表、任务详情、结果版本或已有导出
    Then 均正常返回，不受到期影响

  Scenario: AC-FR-SYS-012-04 线下批准续期、顺延与一次性生效
    Given 某租户订阅为 ACTIVE 且 expires_at 在未来，已提交 PLAN_UPGRADE 申请
    When 运营批准该申请但未填 valid_from，仅填 period_months 或 valid_to
    Then 下次读取订阅时惰性同步为 source=APPROVED、application_id 为该申请
    And 新周期自当前 expires_at 起算（未到期顺延，不截断当前周期）
    When 再次读取订阅
    Then 同一申请不再重复延期（application_id 相同即跳过）
    Given 某租户订阅已 EXPIRED
    When 运营批准其申请
    Then 新周期自批准时的当前时间起算

  Scenario: AC-FR-SYS-012-05 月末夹取与申请档位约束
    Given 某租户的 starts_at 为 2026-01-31
    When 计算一个月后的 expires_at
    Then 结果为 2026-02-28（按目标月实际天数夹取），不溢出到 3 月
    Given 某租户订阅为 ACTIVE 且当前档位为 Starter
    When 提交目标档位为 Kinder 的申请
    Then 返回 409 STATE_CONFLICT / plan.not_upgrade
    When 提交目标档位为 Starter（同档续费）或更高档的申请
    Then 允许提交
    Given 某租户订阅为 EXPIRED 或 NONE
    When 提交任意档位的申请
    Then 允许提交
    Given 该租户已有处理中（SUBMITTED/UNDER_REVIEW/NEEDS_INFO）申请
    When 再次提交申请
    Then 返回 409 STATE_CONFLICT / plan.application_pending
    Given 请求者为企业租户的 MEMBER
    Then 服务端拒绝提交（403 PERMISSION_DENIED / plan.enterprise_owner_only）

  Scenario: AC-FR-SYS-013-01 已批套餐的展示与月页校验
    Given 用户的 Starter 升级申请已被后台批准且订阅为 ACTIVE
    When 用户打开该租户的首页或套餐页
    Then 当前套餐为 Starter，source=APPROVED、is_paid=true、metering=OCR_PAGE
    And 本月无用量时显示 "5,000 / 5,000 pages left this month"，不显示 free 或 Sign-in bonus
    And 页数按泰国自然月实时统计该租户 ocr_jobs.page_count，FAILED 与 CANCELLED 的任务不计
    And 剩余月页额为 0 时创建 OCR 返回 402 QUOTA_EXCEEDED / quota.exceeded

  Scenario: AC-FR-SYS-013-02 申请更高档套餐
    Given 用户当前套餐为 Starter、订阅 ACTIVE 且没有处理中的申请
    When 用户在套餐页点击 Intermediate 的 "Upgrade"
    Then 系统弹出确认框显示目标套餐 Intermediate；点击取消则不创建申请
    When 用户在确认框中点击确认
    Then 系统创建 PLAN_UPGRADE 申请（target_tenant_id 为当前租户）并提示“您的申请已经收到，我们会尽快联系您”，确认后返回首页
    And 再次打开套餐页时页面顶部显示醒目的处理中卡片（含目标套餐与提交时间），Intermediate 卡片带 "IN REVIEW" 角标并显示 "Upgrade in progress"，其他升级按钮不可用
    And 申请 Kinder 被拒绝（plan.not_upgrade），申请 Starter（同档续费）被允许

  Scenario: AC-FR-SYS-013-03 游客不显示套餐横幅
    Given 未登录的游客
    When 打开首页
    Then 不显示套餐与免费额度横幅

  Scenario: AC-FR-SYS-013-04 只有 OCR_PAGE 一种计量，没有 FREE 与赠送
    Given 任意租户（个人、游客或已认证企业）订阅为 ACTIVE 且本月无用量
    When 打开首页或套餐页
    Then plan.metering 恒为 OCR_PAGE，plan.code 不会是 FREE
    And 默认 Kinder 显示 "Kinder · 1,000 / 1,000 pages left this month"，不显示 Free 或 Sign-in bonus
    And 响应中不包含 free_tasks、paid_pages、free_unit 或 paid_unit 字段
    When 成功识别 2 页
    Then 本月剩余页数减少 2，不存在任何赠送次数或额度流水可供回退
    When 取消一个任务
    Then 该任务不计入本月消耗，且没有额度返还步骤
    When 进入下一个 Asia/Bangkok 自然月且没有当月用量
    Then 月可用额恢复为该档位的每月页数
    Given 租户订阅为 EXPIRED 或 NONE
    Then 剩余页数按 0 展示，新建任务按 plan.expired 拒绝（先于 quota.exceeded 判定）

  Scenario: AC-FR-SYS-018-01 到期提醒按节点幂等且不回补
    Given 某已注册用户的个人租户订阅将在 7 天后到期，当天尚未发送提醒
    When OCR worker 进程执行当日的到期提醒扫描
    Then 写入一条 (tenant_id, period_end, stage=D7) 的 plan_reminders 记录
    And 生成一条 PLAN_EXPIRING 站内通知，并在该用户有邮箱且已完成注册时尝试发送邮件
    When 同一泰国日历日再次扫描
    Then 因 (tenant_id, period_end, stage) 唯一约束不重复发送
    Given 当日距到期为 5 天（非 D7/D3/D1/D0 节点）且此前未发送过 D7
    When 执行扫描
    Then 不发送任何提醒，也不回补已错过的 D7
    Given 到期当天与到期之后
    Then 分别发送 stage=D0 的 PLAN_EXPIRING 与 stage=EXPIRED 的 PLAN_EXPIRED，各只发一次
    Given 该租户随后被批准续期，expires_at 改变
    When 新周期再次临近到期
    Then 因 period_end 不同，按节点重新提醒
    Given 租户为游客个人租户
    Then 不产生任何提醒记录、通知或邮件
    Given 邮件发送失败
    Then 站内通知仍已生成，仅 plan_reminders.email_sent 保持 false

  Scenario: AC-FR-SYS-018-02 企业租户的提醒收件人
    Given 某企业租户订阅临近到期，企业有一名 ACTIVE 的 OWNER 与多名 ACTIVE 成员
    When 执行到期提醒扫描
    Then 通知与邮件发给该 ACTIVE OWNER
    Given 该企业没有 ACTIVE 的 OWNER
    Then 回退给最早的 ACTIVE 成员

  Scenario: AC-FR-SYS-018-03 通知中心未读数与标记已读
    Given 已登录用户有若干未读通知
    When 调用 GET /api/v1/me/notifications
    Then 返回 unread_count 与 items 列表
    When 以 {"ids": [<其中一条通知 id>]} 调用 POST /api/v1/me/notifications/read
    Then 仅该通知被标记已读，返回 {"updated": 1, "unread_count": <剩余未读数>}
    When 以同样的 ids 重复调用
    Then 幂等返回 updated=0，未读数不变
    When 以空数组或省略 ids 调用
    Then 该用户的全部未读通知被标记已读，unread_count 变为 0
    Given 请求体的 ids 不是数组，或数组中含非整数（含布尔值）元素
    Then 返回 400 INVALID_ARGUMENT，field_errors 指向 ids，不修改任何通知
    Given ids 中包含其他用户的通知 id
    Then 这些 id 被忽略，只影响本人的未读通知

  Scenario: AC-FR-SYS-014-01 仅 auth 中 LINE 注册信息录入
    Given 尚未注册的 LINE 账号完成服务端验证的真实认证，渠道启用 email scope 且用户授权并返回 email
    When route=auth 且 needsRegistration
    Then 才显示注册框，邮箱默认取验证后的 LINE id_token 的 email 且可编辑，不采用客户端声明的 LINE 邮箱
    And 手机号若 LINE 返回则预填且可编辑，昵称与头像预填且可修改，提供验证码输入框
    Given 用户处于首页、上传或开始 OCR
    Then 不显示注册框，不强制先完成注册
    When 用户修改资料，向当前邮箱发送验证码并输入有效码后提交注册
    Then 保存手机号、邮箱、昵称与头像并完成注册；个人租户的一个月默认 Kinder 在首次登录时已开通，注册不额外发放权益
    And 按 FR-SYS-011 仅回 result（原已 COMPLETED 可 final），不自动 confirm 或跳 plans
    Given LINE 未提供手机号（LINE 不保证提供）
    When 用户手填手机号或留空，其他注册资料与邮箱验证码有效并提交
    Then 均可完成注册，保存手填值或空值，手机号不必填

  Scenario: AC-FR-SYS-014-02 注册邮箱与验证码校验
    Given LINE 未提供邮箱（包括 email scope/用户授权条件不满足），或用户修改了预填邮箱
    When 用户未填写邮箱或填写格式错误的邮箱并点击注册
    Then 系统提示邮箱必填或格式错误，不完成注册
    When 用户未向当前填写的邮箱发送验证码，或未输入验证码并点击注册
    Then 系统提示先发送验证码或验证码必填，不完成注册
    When 用户修改邮箱后使用发往原邮箱的验证码提交
    Then 拒绝注册，要求向当前邮箱重新发送验证码
    When 用户向有效的当前邮箱发送验证码、输入匹配且未过期未使用的验证码并提交
    Then 系统消费验证码、完成注册并保存该邮箱（生产环境校验验证码，仅 FR-SYS-001 明确启用的本地开发不校验）

  Scenario: AC-FR-SYS-014-03 取消注册保留任务权限与已注册资料保护
    Given auth 中注册框已弹出，游客任务已归集到正式账户
    When 用户点击取消
    Then 返回原 result，保留已归集任务访问权限与 LINE/应用会话，不调用退出
    And 清显式 pendingAuth 和 pendingJob 续接标记，不自动续接或 confirm，服务端草稿仍可手动继续
    Given 已注册用户保存过手机号、邮箱、昵称与头像
    When 用户再次通过 LINE 登录
    Then 这些资料保持用户保存的值，不被 LINE 返回值覆盖，不再弹出注册信息框
    Given LINE 登录初查时账号尚未注册，但注册请求随后完成提交
    When 登录刷新取得该用户行锁并重新读取注册状态
    Then 已注册状态与用户保存的资料保持不变，不按初查旧状态写入 LINE 默认资料
    And 个人中心仍可按 FR-SYS-015 修改手机号

  Scenario: AC-FR-SYS-015-01 修改昵称与头像
    Given 已登录用户在个人中心
    When 用户点击资料卡，修改昵称或头像并保存
    Then 个人中心立即显示新的昵称与头像；昵称为空时不可保存

  Scenario: AC-FR-SYS-015-02 修改手机号
    Given 已登录（非游客）用户在个人中心资料卡
    When 用户输入合法手机号（≤32 字符，仅含 +、数字、空格、()、. 、-，剔除非数字后为 6–15 位）并保存
    Then 手机号更新为新值，记录审计 me.update
    When 用户将手机号清空（提交空串）并保存
    Then 手机号被清空，保存成功
    Given 用户提交超过 32 字符、含非法字符，或数字位数不足 6 位/超过 15 位的手机号
    Then 返回 400 INVALID_ARGUMENT，field_errors 为 [{field: "phone", message_key: "error.phone_invalid"}]，手机号不变
    Given 请求者为游客会话
    When 提交 phone
    Then 返回 403 PERMISSION_DENIED，手机号不变

  Scenario: AC-FR-SYS-014-04 注册验证码实际发送、有效期与重发
    Given 生产环境已配置可用的 TLS SMTP，用户已通过真实 LINE 认证但尚未完成注册，填写了有效邮箱
    When 用户点击发送验证码（POST /api/v1/me/email/code）
    Then 服务端通过 ssl 或 starttls SMTP 向当前邮箱实际发送 6 位数字验证码，收件邮箱可收到该码，不以日志或写库替代发送
    And 仅发送成功后记录有效新码的哈希、发送时间及 10 分钟 TTL，按钮进入 60 秒倒计时，发送本身不完成注册
    When 距上次成功发送不足 60 秒再次请求发送
    Then 返回 429，不发送、不产生有效新码
    When 距上次成功发送已满 60 秒再次请求且 SMTP 发送成功
    Then 发送并记录新的 6 位码，重新计算 10 分钟 TTL 与 60 秒重发间隔，旧码失效
    When 用户用旧码提交注册
    Then 拒绝注册（error.email_code_invalid），registered_at 保持为空
    When 用户在新码的 10 分钟有效期内提交匹配且未使用的新码，其他注册资料有效
    Then 消费新码并完成注册

  Scenario: AC-FR-SYS-014-05 发信故障与无效验证码不得完成注册
    Given 生产环境用户尚未完成注册，当前邮箱有效
    When SMTP 未配置，或连接、TLS、认证、发送、超时等任一环节失败，用户请求发送或重发验证码
    Then 返回 503 EMAIL_SERVICE_UNAVAILABLE，不记录有效新码，不完成注册，registered_at 保持为空
    And 不将失败显示为发送成功，不以日志中的码或未发送的新码通过注册校验
    Given 尚未注册用户的当前邮箱验证码分别为错误、已到期（满 10 分钟）或已使用
    When 用户提交注册
    Then 各种情况均拒绝（error.email_code_invalid），registered_at 保持为空，不消费为有效注册、不完成注册

  Scenario: AC-FR-SYS-016-01 更换邮箱
    Given 已登录用户在个人中心点击邮箱「更换」
    When 用户输入新邮箱并点击发送验证码
    Then 系统向新邮箱发送验证码，按钮进入 60 秒倒计时
    When 用户输入验证码并确认
    Then 邮箱更新为新邮箱

  Scenario: AC-FR-SYS-016-02 更换邮箱校验
    Given 用户正在更换邮箱
    Then 新邮箱与当前邮箱相同或格式错误时不可发送验证码
    And 未向当前输入的新邮箱发送验证码或未输入验证码时不可确认
    And 生产环境验证码错误或过期时拒绝更换（开发环境不校验验证码）

  Scenario: AC-FR-SYS-017-01 租户刷新后保持
    Given 已登录用户在首页将当前租户切换为已认证企业
    When 用户刷新页面或重新登录
    Then 当前租户仍为该企业租户
    And 若该企业已解绑或不再可用，则回落为本人个人租户

  Scenario: AC-FR-SYS-017-02 个人与企业数据隔离、企业成员共享
    Given 用户 A（企业 OWNER）与用户 B（企业 MEMBER）各有个人任务，并各在企业租户下有任务
    When A 处于本人个人租户
    Then 首页最近任务与历史页仅显示 A 的个人任务
    When A 或 B 切换到该企业租户
    Then 仅显示该企业租户的任务，且包含 A 与 B 在企业租户下创建的任务
    Given 请求携带无法解析或不可见的 tenant_id
    Then 返回 400 INVALID_ARGUMENT / error.invalid_workspace（列表接口对不可见租户返回 404）
    Given 成员关系被撤销、企业不再 VERIFIED 或租户非 ACTIVE
    Then 返回 403 ENTERPRISE_ACCESS_REVOKED / error.enterprise_access_revoked

  Scenario: AC-FR-SYS-017-03 企业租户单独申请套餐
    Given 企业租户订阅已到期（EXPIRED），企业 OWNER 处于该企业租户
    When OWNER 在套餐页申请 Kinder 并确认
    Then 创建 target_tenant_id 为该企业租户的 PLAN_UPGRADE 申请，本人个人租户的订阅状态不变
    And 该企业的 MEMBER 在套餐页看到同一处理中申请，但不能提交（403 plan.enterprise_owner_only）
    When 后台批准该申请并写入有效期
    Then 下次读取订阅时惰性同步为 APPROVED Kinder，企业全体 ACTIVE 成员共享该订阅与月页额，个人租户独立计量不受影响
```

## 6. 可追溯性
| FR ID | 验证方式 | 设计引用 |
|-------|----------|----------|
| FR-SYS-001..018 | AC-FR-SYS-*（含 AC-FR-SYS-001-04/05/06、AC-FR-SYS-011-02、AC-FR-SYS-012-04/05、AC-FR-SYS-014-04/05、AC-FR-SYS-015-02、AC-FR-SYS-018-01/02/03） | `DM-User`、`DM-Role`、`DM-OperationLog`、`DM-Settings`、`API-8`；FR-SYS-001/014：[Architecture §6](../../30-design/Architecture.md#6-安全性与可靠性)；FR-SYS-012/013/017：`GET /api/v1/me/subscription?tenant_id`、`POST /api/v1/me/plan-applications`（body 可选 `tenant_id`）、`GET /api/v1/plans`（仅目录）、`GET /api/v1/me/quota`、`GET /api/v1/me/tenants`、`GET /api/v1/ocr/jobs?tenant_id`、`tenants` / `subscriptions` 表、`applications.target_tenant_id`、`enterprises.tenant_id` / `verified_at`（Data-Model §2.13.1）；FR-SYS-018：`plan_reminders` 表、`GET /api/v1/me/notifications`、`POST /api/v1/me/notifications/read`、`PLAN_REMINDERS_ENABLED`、[Architecture §4](../../30-design/Architecture.md)；FR-SYS-014/015/016：`POST /api/v1/me/registration`、`PATCH /api/v1/me`（`display_name`/`phone`/`language`/`avatar_url`）、`POST /api/v1/me/email/code`、`POST /api/v1/me/email`、`DM-User`（`phone`/`email`/`registered_at`）、`email_verification_codes` |

## 版本历史
| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.7.5 | 2026-11-06 | Product Engineering | FR-SYS-005 的 OCR 引擎与大模型配置部分已迁移至 `openspec/specs/ocr-settings/spec.md`（web-admin-console）；路径与模板参数随 B-3、B-4 |
| 1.7.4 | 2026-11-05 | Product Engineering | FR-SYS-004 已迁移至 `openspec/specs/line-mini/spec.md`（默认语言改为英语）；FR-SYS-018 已迁移至 `openspec/specs/notifications/spec.md` |
| 1.7.3 | 2026-11-05 | Product Engineering | FR-SYS-001、003、010、014、015、016 已迁移至 `openspec/specs/identity/spec.md`；FR-SYS-012、013 已迁移至 `openspec/specs/billing/spec.md`；本处保留为历史参考 |
| 1.7.2 | 2026-11-04 | Product Engineering | FR-SYS-002、009、017 已迁移至 `openspec/specs/tenancy/spec.md`（rebuild-tenant-rbac）；本处保留为历史参考 |
| 1.7.1 | 2026-10-28 | Product Engineering | FR-SYS-001/011：LIFF 20 秒超时、安全失败分类、显式按钮一次官方入口重开（同一 sessionStorage 上下文）、保留意图/任务、不转发凭据与不回退 dev；取消 SDK 等待失效与迟到结果保护；新增 AC-001-07，真实手机 WebView/授权另验 |
| 1.7.0 | 2026-10-28 | Product Engineering | 归属改为单一 `tenant_id`（`tenants` / `enterprises.tenant_id` / `applications.target_tenant_id`，保留 `error.invalid_workspace`、`error.enterprise_access_revoked` 等旧 message_key）；重写 FR-SYS-012（每租户只开通一个月 Kinder：个人自 `tenants.created_at`、企业自 `enterprises.verified_at`，未认证为 NONE，到期硬停 402 `plan.expired`、历史仍可读，线下审批写有效期并惰性顺延、同档续费允许、降档 409）与 FR-SYS-013（唯一计量 `OCR_PAGE`，按泰国自然月实时统计 `ocr_jobs.page_count`，FAILED/CANCELLED 不计，页数用尽 402 `quota.exceeded`；删除 FREE 档、赠送额度、额度流水与 `free_tasks`/`paid_pages`）；FR-SYS-015 手机号改为个人中心可改可清空（原「只读」表述全部作废）；FR-SYS-017 改为按租户隔离；新增 FR-SYS-018 到期提醒（D7/D3/D1/D0/EXPIRED，`uq_plan_reminder_stage` 幂等、不回补、游客不提醒、worker 内低频扫描、`PLAN_REMINDERS_ENABLED`）与通知中心标记已读；新增 AC-FR-SYS-012-04/05、015-02、018-01/02/03 并改写 012/013/014-01/014-03/017 相关 AC。本次为文档与 OpenAPI 契约对齐，未运行任何测试 |
| 1.6.9 | 2026-10-27 | Product Engineering | FR-SYS-001/010..014：认证/退出/注册默认 Kinder 已真实实现并正式发布；334 项隔离后端、final index-BUTDgRGj.js 的 21 项全 mock 浏览器、6 项 OAuth 源码模拟、9 项前端会话边界及类型检查/Vite 构建/OpenAPI 283 个内部引用通过；AC-001-03 明确失败/10 秒超时锁主壳，Back/刷新按 session CSRF-only→logout→guest 重试并回 scan，不留旧 My、不自动 LINE 兑换；registered_at 动态默认每泰国月 1,000 页，无新增 schema/默认申请/付款/历史迁移；发布引用 Architecture §5/§6，历史 221/5 与 SMTP 接收非本轮证据，SMTP 模块/秘密版本引用不变、本轮未实发邮件，隔离不连接数据库/真实 LINE/SMTP、不创建生产账户；真实 LINE/收件箱/数据库并发/防猜码仍未验证，原业务规则不变 |
| 1.6.8 | 2026-10-27 | Product Engineering | FR-SYS-001/010..014：退出标记/超时/刷新防复登，Cookie/游客主壳且仅显式 LINE 兑换，结果 Continue 才触发 auth/注册；取消保留任务权限、pending 意图分离与成功导航后清任务；个人 DEFAULT ACTIVE Kinder 真实每月 1,000 页、已批优先、赠送独立、企业不继承；服务端 confirm:true 注册门禁拒绝在写版本前；同步代表性/汇总 AC（新增 SYS-011-02），本轮仅文档契约、待验证，历史发布不覆盖，保留 SMTP/资料锁与环境边界 |
| 1.6.7 | 2026-10-27 | Product Engineering | FR-SYS-014：补充登录刷新锁后重新读取注册状态的资料保护；221 项隔离测试与 SMTP 本地/Cloud Run 自测接收通过，发布证据与真实 LINE/收件箱/数据库并发、防猜码未验证边界统一链接 Architecture §6；不改变游客触发和个人中心只读规则 |
| 1.6.6 | 2026-10-27 | Product Engineering | 仅 FR-SYS-014 注册三点：手机号默认 LINE 返回值、注册时可编辑/手填保存且仍可选；邮箱默认来自服务端验证的 LINE token，需 email scope/用户授权且可编辑；纳入标准库 TLS SMTP 六位验证码，Gmail 发件配置与凭据隔离见 Architecture §6；新增 AC-FR-SYS-014-04/05，记录本次验证/发布未完成；保留 SYS-010/011 触发、SYS-015 个人中心手机号只读及历史发布事实 |
| 1.6.5 | 2026-10-27 | Product Engineering | FR-SYS-001/014/016：线上仅真实 LINE 联合认证、本地明确启用独立 Developer sign-in；撤销临时生产 dev 例外，明确请求与旧会话拒绝、数据保留及不回退；新增 AC-FR-SYS-001-04/05/06，保留注册/发信范围与历史，不改变游客流程 |
| 1.6.4 | 2026-10-18 | Product Engineering | FR-SYS-014/016：LINE 暂不可用期间正式部署临时开启开发调试，与本地一致（后端 `AUTH_DEV_MODE=true`、前端 `VITE_DEV_BYPASS=true`）；恢复 LINE 时须关闭；不新增 AC |
| 1.6.3 | 2026-10-18 | Product Engineering | 详细规则链接 NFR-USAB-004 与 Architecture §3.1，继承 LINE Mini App 品牌等待横切约束；不新增 FR 或重复 AC，不改变认证、套餐与确认行为 |
| 1.6.2 | 2026-10-18 | Product Engineering | FR-SYS-011/012：LINE 核验确认前认证与任务工作空间订阅分流；Free/NONE、无付费的 PENDING 不确认，ACTIVE（含更高档升级处理中）可显式确认；登录/注册或套餐恢复后未完成任务返回结果页；同步 AC |
| 1.6.1 | 2026-10-18 | Product Engineering | FR-SYS-010：游客数据归集后删除游客账户（含会话、验证码、头像），配额流水随任务转入正式账户，游客首登赠送作废；更新 AC-FR-SYS-010-02 |
| 1.6.0 | 2026-10-18 | Product Engineering | 新增 FR-SYS-017：工作空间刷新后保持、个人/企业数据隔离、企业成员共享；FR-SYS-012/013：订阅与付费配额按工作空间计，企业空间仅 OWNER 可单独申请升级、全体成员共享；新增 AC-FR-SYS-017-01/02/03 |
| 1.5.4 | 2026-10-18 | Product Engineering | FR-SYS-001：个人中心登出前须弹出确认框；新增 AC-FR-SYS-001-03 |
| 1.5.3 | 2026-10-18 | Product Engineering | FR-SYS-013：注册后未开通付费套餐的用户为免费版 `Free`（享 1,000 次赠送扫描），不再显示为 `Kinder`；`Kinder` 可升级；新增 AC-FR-SYS-013-04 |
| 1.5.2 | 2026-10-18 | Product Engineering | FR-SYS-014/015：上传的头像改存 Firebase Storage，DB 仅存对象名，经 `GET /api/v1/me/avatar` 鉴权代理读取 |
| 1.5.1 | 2026-10-18 | Product Engineering | FR-SYS-014：注册信息框的邮箱改为可修改，新增邮箱验证码输入（开发环境不校验）；更新 AC-FR-SYS-014-01/02 |
| 1.5.0 | 2026-10-17 | Product Engineering | 新增 FR-SYS-014（LINE 注册信息录入弹框）、FR-SYS-015（个人中心修改昵称/头像）、FR-SYS-016（凭新邮箱验证码更换邮箱）；开发环境 LINE 资料随机、验证码不校验 |
| 1.4.2 | 2026-10-17 | Product Engineering | FR-SYS-013：付费套餐按每月页数计量与展示（首页横幅、套餐页当前套餐卡），去掉 free 描述；付费个人空间任务按本月剩余页数校验 |
| 1.4.1 | 2026-10-17 | Product Engineering | FR-SYS-013：套餐页处理中提示改为顶部醒目橙色卡片（标题、说明、提交时间），处理中套餐卡橙色描边 + IN REVIEW 角标 |
| 1.4.0 | 2026-10-17 | Product Engineering | 新增 FR-SYS-013：套餐展示跟随已开通套餐、套餐页升级至更高档（人工审批，提交前需确认框）、游客首页隐藏套餐横幅；FR-SYS-012 当前套餐取已批准最高档 |
| 1.3.0 | 2026-10-17 | Product Engineering | 新增 FR-SYS-012：确认后按订阅状态分流（未开通提交升级申请 / 处理中提示页 / 已开通直达最终结果页）；FR-SYS-011 收敛为确认后认证 |
| 1.2.0 | 2026-10-17 | Product Engineering | 新增游客试用与数据归集、确认后登录/注册及默认 `Kinder` 订阅计划检查页 |
| 1.1.0 | 2026-10-06 | Product Engineering | 新增复核与报表查看权限配置，并将存储设置同步为 GCS 架构 |
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容与验收场景翻译为简体中文 |
| 1.0.0 | 2026-09-10 | Product Engineering | 根据 PRD 第 4.6 节生成初始基础系统需求 |
