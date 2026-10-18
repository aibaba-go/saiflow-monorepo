---
doc_id: EPIC-06
title: "EPIC-06 — 基础系统（账户、权限、配置、i18n）"
type: epic
status: active
version: 1.6.4
updated: 2026-10-18
owner: Product Engineering
priority: P0
source: "PRD-001 §4.6"
related: [DM-User, DM-Role, DM-OperationLog, API-8]
---

# EPIC-06 — 基础系统（账户、权限、配置、i18n）

## 1. Epic 摘要
- **目标：** 提供每个其他 epic 都依赖的基础系统服务：身份、基于角色的访问控制、操作审计、多语言 UI 和本地配置。
- **范围内：** 注册/登录、RBAC 权限、操作日志、语言切换（泰语/英语/中文）、基础参数配置、本地存储设置。
- **主要参与者：** P-07 系统管理员（配置）；所有用户（登录/语言）。
- **关键实体：** `DM-User`、`DM-Role`、`DM-OperationLog`、`DM-Settings`。

## 2. 需求

| ID | 陈述（系统必须……） | 优先级 | 来源 | 依赖项 | 验证方式 |
|----|--------------------|--------|------|--------|----------|
| FR-SYS-001 | 支持用户注册和登录（本地账户） | P0 | §4.6 | — | AC-FR-SYS-001-01/02/03 |
| FR-SYS-002 | 强制实施基于角色的访问权限 | P0 | §4.6 | FR-SYS-001 | AC-FR-SYS-002-01 |
| FR-SYS-003 | 为每个改变状态的操作记录操作日志 | P0 | §4.6,§5.3 | FR-SYS-001 | AC-FR-SYS-003-01 |
| FR-SYS-004 | 允许在泰语 / 英语 / 中文之间切换 UI 语言 | P0 | §4.6 | — | AC-FR-SYS-004-01 |
| FR-SYS-005 | 提供基础参数配置（路径、阈值、模板） | P0 | §4.6 | FR-SYS-002 | AC-FR-SYS-005-01 |
| FR-SYS-006 | 提供归档与存储设置（GCS 对象前缀、命名规则） | P0 | §4.6 | FR-SYS-002 | AC-FR-SYS-006-01 |
| FR-SYS-009 | 允许管理员为角色授予复核与报表查看权限 | P0 | PRD §1.2, §4.6 | FR-SYS-002 | AC-FR-SYS-009-01 |
| FR-SYS-007 | 重复登录失败后锁定账户 | P1 | §5.3 | FR-SYS-001 | AC-FR-SYS-007-01 |
| FR-SYS-008 | 保留每位用户的偏好（语言、默认导出路径） | P1 | §4.6 | FR-SYS-001 | AC-FR-SYS-008-01 |
| FR-SYS-010 | 允许匿名访客以游客会话完成上传、识别与核验，并在登录/注册后归集其数据 | P0 | 用户流程调整 2026-10-17 | FR-SYS-001 | AC-FR-SYS-010-01/02 |
| FR-SYS-011 | LINE Mini App 结果页 Continue 在核验确认前要求未登录或未完成注册的用户登录/注册，不提交确认；完成认证与注册后按任务所属工作空间的订阅状态恢复流程（见 FR-SYS-012） | P0 | 用户流程调整 2026-10-17/18 | FR-SYS-001, FR-SYS-010 | AC-FR-SYS-011-01 |
| FR-SYS-012 | LINE Mini App 在核验确认前按任务所属工作空间的订阅状态分流：Free/NONE→订阅计划检查页（默认 `Kinder`）；无已开通付费套餐的 PENDING→升级处理中页，均不提交确认；ACTIVE（含更高档升级处理中）→允许显式确认后进入最终结果页，恢复未完成任务须先返回结果页 | P0 | 用户流程调整 2026-10-17/18 | FR-SYS-011 | AC-FR-SYS-012-01/02/03 |
| FR-SYS-013 | 已登录用户的套餐展示跟随已开通套餐（未开通时为免费版 `Free`，享注册赠送的 1,000 次文档扫描额度），并可在套餐页申请升级至更高档套餐（后台人工审批）；未登录（游客）首页不显示套餐横幅 | P0 | 用户流程调整 2026-10-17/18 | FR-SYS-012 | AC-FR-SYS-013-01/02/03/04 |
| FR-SYS-014 | 通过 LINE 注册：LINE 认证后首次进入弹出注册信息框（手机号取自 LINE 且不可改；邮箱默认取自 LINE、可修改、必填，并须凭发往该邮箱的验证码确认；昵称、头像取自 LINE 且可改），提交后完成注册 | P0 | 用户流程调整 2026-10-17/18 | FR-SYS-001 | AC-FR-SYS-014-01/02/03 |
| FR-SYS-015 | 个人中心（My）可修改用户昵称与头像 | P0 | 用户流程调整 2026-10-17 | FR-SYS-014 | AC-FR-SYS-015-01 |
| FR-SYS-016 | 个人中心（My）可更换邮箱：输入新邮箱，系统向新邮箱发送验证码，凭验证码确认更换 | P0 | 用户流程调整 2026-10-17 | FR-SYS-014 | AC-FR-SYS-016-01/02 |
| FR-SYS-017 | 工作空间（个人 / 已认证企业）可切换且刷新后保持；个人与企业空间的任务数据、套餐与配额相互隔离，企业空间的数据、套餐与配额由该企业全体有效成员共享 | P0 | 用户流程调整 2026-10-18 | FR-SYS-002, FR-SYS-012 | AC-FR-SYS-017-01/02/03 |

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
> 游客会话不是 RBAC 角色：仅可访问本人上传、识别、核验与导出，不可访问管理、报表或配置；登录/注册后由正式用户认领其数据，游客会话随即失效。

## 4. 规则
- **密码：** 使用强单向哈希（例如 bcrypt/argon2）存储；绝不存储明文（见 `NFR-SEC`）。
- **登出（FR-SYS-001）：** 个人中心点击 `Sign out` 先弹出确认框（可取消）；取消不登出，确认后调用 `POST /api/v1/auth/logout` 撤销会话并回到登录页。
- **操作日志（FR-SYS-003）：** 仅可追加；采集 `user`、`action`、`target`、`timestamp`、`result`。用于可追溯性和防篡改证据。
- **语言（FR-SYS-004）：** 默认 = 泰语；切换立即生效且无需重启；所有面向用户的字符串均外部化（i18n 资源包）。
- **配置（FR-SYS-005/006）：** 变更需要 `admin`；变更会被记录。
- **品牌等待（横切规则）：** LINE Mini App 的启动、页面、局部请求与按钮等待继承 [NFR-USAB-004](../non-functional/NFR.md)，设计见 [Architecture §3.1](../../30-design/Architecture.md#31-line-mini-app-品牌等待设计)；不改变既有请求、认证、套餐分流或确认规则，套餐 `PENDING` 不视为网络加载，验收沿用汇总标准，不新增 FR 或重复 AC。
- **游客试用（FR-SYS-010）：** 匿名访客首次进入应用时创建游客会话，可使用上传、识别与核验；游客数据仅本人可见。登录或注册成功后，游客名下的全部数据（文档、识别任务、结果版本、导出记录、通知、审计、申请与配额消耗/返还流水）归集至正式账户，并在同一事务内删除游客账户及其会话、验证码与头像对象；游客的首登赠送作废（不与正式账户的赠送叠加），记录审计 `guest.claim`。
- **确认前认证（FR-SYS-011）：** LINE Mini App 结果页 `Continue` 在核验确认前检查认证与注册完成状态；游客或未完成注册信息录入者先进入登录/注册页（`auth`），不提交确认。认证与注册完成、游客数据归集后，再按该任务所属工作空间的订阅状态恢复流程（FR-SYS-012），不自动确认任务。
- **确认前订阅分流（FR-SYS-012）：** 订阅按工作空间计（见 FR-SYS-017），已注册用户在核验确认前取**该任务所属工作空间**的订阅，而非其他空间的套餐；套餐升级申请复用 `applications`（`type = PLAN_UPGRADE`，表单含 `plan_code`、`plan_name`、`workspace_type`、`enterprise_id`），由后台人工审核。个人空间的申请 = 本人提交且 `target_enterprise_id` 为空；企业空间的申请 = `target_enterprise_id` 为该企业（不论哪位成员提交）。状态判定：存在 `APPROVED` 申请 = 已开通（ACTIVE，取已批准申请中档位最高者为当前套餐）；无已开通但存在 `SUBMITTED / UNDER_REVIEW / NEEDS_INFO` 申请 = 处理中（PENDING）；否则 = 未开通（NONE）。
  - NONE（Free）：不提交核验确认，进入订阅计划检查页（`plans`），默认选中 `Kinder`，按钮为 `Upgrade to {套餐名}`；提交升级申请后提示“您的申请已经收到，我们会尽快联系您”，用户确认提示后返回首页；申请与提示确认不等于核验确认。
  - PENDING（无已开通付费套餐）：不提交核验确认，直接进入“套餐升级处理中”页（`plan-pending`），显示申请套餐与提交时间，可返回首页。
  - ACTIVE（含已开通且另有更高档升级申请处理中）：允许已注册用户在结果页显式继续，经核验校验后提交 `confirm: true`；成功后才锁定结果、记录 `completed_at` 并进入最终结果页。
  - 因认证或订阅检查重定向前，仅在结构化内容存在未保存变更时，以现有 PATCH 结果操作的 `confirm: false` 保存；无变更不保存，不锁定结果、不记录 `completed_at`（FR-VERIFY-015/016）。
  - 登录/注册或套餐可用性恢复时，重新读取任务阶段与其工作空间订阅；ACTIVE 的未完成任务（`VERIFYING` 或历史 `VERIFIED`）返回结果页等待显式继续，不自动确认或直接进入最终结果页。只有已经 `COMPLETED` 的任务可直接进入最终结果页；NONE/PENDING 仍按上述分流。历史 `VERIFIED` 保留兼容，不批量转换，仅已注册付费用户可显式继续完成。
  - 已有处理中的申请时，服务端拒绝再次提交（`409 STATE_CONFLICT`，`plan.application_pending`）。提交记录审计并给用户发送站内通知。
- **套餐展示与升级（FR-SYS-013）：** 注册后未开通任何付费套餐的用户处于免费版（`Free`，`plan.code = FREE`，不在可购买套餐目录中），仅享首次登录赠送的 1,000 次文档扫描额度；付费套餐档位顺序为 `Kinder < Starter < Intermediate < Advance`，免费版低于所有付费套餐。
  - 当前工作空间的配额视图（首页横幅、套餐页当前套餐卡）显示该空间已开通套餐名称（`is_paid = true`）；未开通时显示 `Free`（首页横幅 `Free · 剩余 / 1,000 free scans left`，套餐页当前套餐卡标题 `Free` + Sign-in bonus 角标），套餐目录中不标记任何付费套餐为当前套餐，`Kinder` 及以上均可 `Upgrade`。个人与企业空间的套餐互不影响：企业空间未开通时同样为 `Free`（享企业认证赠送的 1,000 次），可单独申请升级。首页横幅与当前套餐卡按 `is_paid` 区分：付费套餐按套餐每月页数计量，显示“套餐名 · 剩余 / 每月页数 pages left this month”（如 Intermediate 为 10,000 页/月；本月已识别页数按泰国时间自然月统计，失败/取消任务不计；企业空间汇总全体成员在该企业空间的任务），不含 free 字样与 Sign-in bonus 角标；免费版保留“free scans left”。
  - 工作空间开通付费套餐后，在该空间创建 OCR 任务按本月剩余页数校验（为 0 时返回 `quota_exceeded`），不再消耗免费任务；免费额度与付费额度不合并。
  - 企业成员仅有两种角色：所有者 `OWNER` 与普通成员 `MEMBER`。企业空间的套餐升级申请仅 `OWNER` 可提交；`MEMBER` 可查看企业当前套餐与处理中申请，套餐页显示“仅公司所有者可申请升级”提示，升级按钮不可用，服务端拒绝其提交（`403 PERMISSION_DENIED`，`plan.enterprise_owner_only`）。
  - 套餐页（已登录）：当前套餐标记“Current plan”；更高档套餐显示 `Upgrade`，点击即提交升级申请，提示“您的申请已经收到，我们会尽快联系您”，确认后返回首页；更低档套餐不提供操作；有处理中申请时该套餐显示 `Upgrade in progress` 并以橙色描边与 `IN REVIEW` 角标突出，其他升级按钮禁用；页面最顶部（当前套餐卡之上）显示醒目的橙色处理中卡片（图标、标题 `Upgrade to {套餐名} in progress`、销售联系说明与提交时间）。
  - 已开通用户申请的目标档位必须高于当前套餐，否则拒绝（`409 STATE_CONFLICT`，`plan.not_upgrade`）。后台批准后当前套餐即切换为新档位。
  - 提交任一套餐升级申请（订阅计划检查页的 `Upgrade to {套餐名}` 或套餐页的 `Upgrade`）前，必须先弹出确认框（显示目标套餐，可取消）；取消不产生申请，确认后才提交。
  - 未登录（游客）首页不显示套餐横幅；游客的套餐页不显示当前套餐卡，套餐按钮仅为线下联系说明且不可提交。
- **LINE 注册信息录入（FR-SYS-014）：** 注册仅通过 LINE 完成。LINE 认证成功后，若该账号尚未完成注册（`users.registered_at` 为空），在进入应用前弹出注册信息框：
  - 手机号：取自 LINE（`phone_number` 声明），只读不可修改；LINE 未提供时显示“LINE 未提供”。
  - 邮箱（必填）：默认取自 LINE（`email` 声明），可修改；取不到时由用户录入。须点击「发送验证码」向该邮箱发送验证码（与 FR-SYS-016 相同的发送接口、有效期与重发间隔；未注册时允许向当前邮箱发送），并输入验证码后才可提交；修改邮箱后须重新发送。验证码校验规则同 FR-SYS-016（开发环境不校验）。
  - 昵称（必填，≤128 字符）与头像：默认取自 LINE，可修改；头像在客户端居中裁剪为 256px JPEG 后上传，服务端仅接受 https URL 或 ≤300KB 的 png/jpeg/webp data URL（声明类型须与文件头一致）。
  - 头像存储：上传的头像图片保存至 Firebase Storage（私有桶，对象名 `avatars/<user_id>/<随机名>.<ext>`），`users` 表只保存对象名，不保存图片数据；替换或清空头像后删除旧对象。前端经 `GET /api/v1/me/avatar`（会话鉴权的后端代理，不生成匿名或签名 URL）读取。LINE 提供的 https 头像 URL 仅作引用保存，不转存。上传失败返回 `503 STORAGE_UNAVAILABLE`（`avatar.upload_failed`）。
  - 提交 `POST /api/v1/me/registration` 后完成注册并按 FR-SYS-011/012 继续；取消则撤销本次会话并回到登录页。重复提交返回 `409 STATE_CONFLICT`（`registration.already_done`）。提交记录审计 `user.register`。
  - 已注册用户再次 LINE 登录时，不再用 LINE 资料覆盖用户自行维护的昵称、头像与邮箱。功能上线前已存在的正式账号视为已注册。
  - 开发环境（`AUTH_DEV_MODE`）：模拟的 LINE 资料（手机号、邮箱、昵称、头像）随机生成，约 1/3 概率不带邮箱以覆盖必填录入；登录页「注册」每次模拟一个新的 LINE 账号。
  - 临时（LINE 暂不可用期间）：正式部署与本地开发调试一致——后端镜像默认 `AUTH_DEV_MODE=true`，前端生产构建 `VITE_AUTO_DEV_LOGIN=true` 且 `VITE_DEV_BYPASS=true`（登录页显示开发者登录，Login/Register with LINE 直接使用开发身份）。此期间任何人可凭任意开发身份登录，邮箱验证码不发信、不校验；恢复 LINE 联合登录时必须同时关闭上述开关。
- **资料修改（FR-SYS-015）：** 个人中心资料卡可点击，弹框修改昵称与头像（`PATCH /api/v1/me`，字段白名单 `display_name`/`avatar_url`/`language`）；手机号只读展示。游客不可修改头像。修改记录审计 `me.update`。
- **更换邮箱（FR-SYS-016）：** 个人中心邮箱行点击「更换」，录入新邮箱后点击「发送验证码」（`POST /api/v1/me/email/code`，6 位数字，10 分钟有效，60 秒内不可重发 → `429`），再输入验证码确认（`POST /api/v1/me/email`）。新邮箱不得与当前邮箱相同；须先向该新邮箱发送过验证码才可确认。
  - 生产环境需配置发信服务，未配置时发送接口返回 `503 EMAIL_SERVICE_UNAVAILABLE`，验证码须匹配且未过期、未使用（`error.email_code_invalid`）。
  - 开发环境不实际发信（验证码仅写入服务端日志），确认时不校验验证码。
  - 发送与更换均记录审计（`me.email_code`、`me.email_change`）。
- **工作空间切换与隔离（FR-SYS-017）：** 可选工作空间 = 个人空间 + 本人为 `ACTIVE` 成员且企业为 `VERIFIED` 的企业空间；在首页身份 chip 或个人中心切换。
  - 保持：所选工作空间按用户记忆在本机（`localStorage`，键 `saiflow_ws_<user_id>`，仅存企业 ID 或 `PERSONAL`），刷新或重新登录后恢复；若该企业已解绑、成员资格失效或企业不再为 `VERIFIED`，回落个人空间。
  - 数据隔离：首页最近任务与历史页仅列出当前工作空间的任务（`GET /api/v1/ocr/jobs?workspace_type=PERSONAL` 或 `workspace_type=ENTERPRISE&enterprise_id=…`），切换后立即刷新；个人空间仅含本人的个人任务，不出现企业任务，反之亦然。上传与 URL 导入的文件归属当前工作空间，其后的任务与结果随文件归属。
  - 企业共享：企业空间的文件、任务与结果对该企业全体 `ACTIVE` 成员可见；企业套餐与配额（免费额度、付费套餐每月页数）由全体成员共享并合并计量（见 FR-SYS-013）。
  - 个人与企业空间的套餐、配额分别计量，互不抵扣。

## 5. 代表性验收标准

```gherkin
Feature: EPIC-06 基础系统

  Scenario: AC-FR-SYS-001-01 登录成功
    Given 已注册且具有有效凭据的用户
    When 用户登录
    Then 系统 SHALL 创建会话并授予该用户的角色权限

  Scenario: AC-FR-SYS-001-03 登出需确认
    Given 已登录用户在个人中心
    When 用户点击 "Sign out"
    Then 系统弹出登出确认框
    When 用户点击取消
    Then 确认框关闭，用户仍保持登录
    When 用户再次点击 "Sign out" 并在确认框中确认
    Then 会话被撤销并回到登录页

  Scenario: AC-FR-SYS-002-01 权限强制执行
    Given 角色为 "viewer" 的用户
    When 用户尝试导出数据
    Then 系统 SHALL 拒绝该操作并记录该次尝试

  Scenario: AC-FR-SYS-004-01 语言切换
    Given UI 当前为泰语
    When 用户将语言切换为英语
    Then 所有 UI 标签更新为英语，且无需重启应用

  Scenario: AC-FR-SYS-010-01 游客试用
    Given 匿名访客首次进入应用
    When 访客上传文档并完成识别与核验
    Then 访客仅能访问自己的任务与结果，且不获得管理、报表或配置权限

  Scenario: AC-FR-SYS-010-02 游客数据归集
    Given 游客已完成上传与识别
    When 游客登录或注册为正式用户
    Then 其文档、任务、结果版本、导出记录与配额消耗流水归集至该正式用户
    And 游客账户及其会话被删除，游客的首登赠送不叠加到正式用户

  Scenario: AC-FR-SYS-011-01 确认前登录或注册与任务恢复
    Given 用户为游客或尚未完成注册信息录入，任务尚未最终完成
    When 用户在 LINE Mini App 结果页点击 "Continue"
    Then 在提交确认前进入 auth，用户可登录或注册，不提交 confirm: true
    When 用户完成登录或注册，系统归集游客数据并读取该任务工作空间的订阅
    Then NONE 进入 plans，PENDING 且无已开通付费套餐进入 plan-pending
    And ACTIVE 返回该未完成任务的结果页（result）等待用户显式继续，不自动确认或进入最终结果页
    Given 恢复的任务已为 COMPLETED 且该任务工作空间订阅 ACTIVE
    Then 可直接进入最终结果页

  Scenario: AC-FR-SYS-012-01 Free/NONE 确认前提交套餐升级申请
    Given 用户已登录并完成注册，未确认任务所属工作空间为 Free/NONE 且没有套餐升级申请，即使其他工作空间已开通付费套餐
    When 用户在结果页点击 "Continue"
    Then 不提交 confirm: true，进入订阅计划检查页（plans），默认选中 `Kinder`，按钮显示 "Upgrade to Kinder"
    And 重定向前仅有未保存变更时以 PATCH confirm: false 保存，无变更不保存；结果不锁定、任务保持 VERIFYING、completed_at 为空
    When 用户选择套餐并点击按钮，在套餐升级确认框中确认申请
    Then 系统创建状态为 SUBMITTED 的 PLAN_UPGRADE 申请，并提示“您的申请已经收到，我们会尽快联系您”
    And 用户确认提示后返回首页，任务仍未确认且未最终完成

  Scenario: AC-FR-SYS-012-02 无已开通付费套餐的 PENDING
    Given 用户已登录并完成注册，未确认任务所属工作空间无已开通付费套餐且存在处理中的套餐升级申请（PENDING）
    When 用户在结果页点击 "Continue"
    Then 不提交 confirm: true，直接进入“套餐升级处理中”页（plan-pending），显示申请套餐与提交时间
    And 重定向前仅有未保存变更时以 PATCH confirm: false 保存，无变更不保存；结果不锁定、任务保持 VERIFYING、completed_at 为空

  Scenario: AC-FR-SYS-012-03 ACTIVE 显式确认与套餐可用性恢复
    Given 用户已登录并完成注册，任务所属工作空间存在 APPROVED 的付费套餐申请（ACTIVE），包括另有更高档升级申请处理中的情况
    When 用户在结果页点击 "Continue" 且通过核验校验
    Then 先检查认证与该任务工作空间订阅，再提交 confirm: true
    And 仅确认成功后锁定结果、记录 completed_at 并进入最终结果页
    Given 因订阅检查中断的任务尚为 VERIFYING 或历史 VERIFIED
    When 该任务工作空间套餐开通或可用性恢复为 ACTIVE，用户恢复该任务
    Then 返回结果页（result）等待用户显式继续，不自动提交确认或进入最终结果页
    When 用户在结果页再次显式继续并确认成功
    Then 任务变为 COMPLETED 并进入最终结果页
    Given 恢复的任务已经 COMPLETED 且其工作空间订阅 ACTIVE
    Then 可直接进入最终结果页，无需再次确认

  Scenario: AC-FR-SYS-013-01 已开通套餐的展示
    Given 用户的 Starter 升级申请已被后台批准
    When 用户打开首页或套餐页
    Then 首页横幅与当前套餐卡显示 "Starter"，套餐页将 Starter 标记为当前套餐

  Scenario: AC-FR-SYS-013-02 升级至更高档套餐
    Given 用户当前套餐为 Starter 且没有处理中的申请
    When 用户在套餐页点击 Intermediate 的 "Upgrade"
    Then 系统弹出确认框显示目标套餐 Intermediate；点击取消则不创建申请
    When 用户在确认框中点击确认
    Then 系统创建 PLAN_UPGRADE 申请并提示“您的申请已经收到，我们会尽快联系您”，确认后返回首页
    And 再次打开套餐页时页面顶部显示醒目的处理中卡片（含目标套餐与提交时间），Intermediate 卡片带 "IN REVIEW" 角标并显示 "Upgrade in progress"，其他升级按钮不可用
    And 申请 Kinder 或 Starter 被拒绝（plan.not_upgrade）

  Scenario: AC-FR-SYS-013-03 游客不显示套餐横幅
    Given 未登录的游客
    When 打开首页
    Then 不显示套餐与免费额度横幅

  Scenario: AC-FR-SYS-013-04 注册后为免费版
    Given 刚完成注册且没有已批准套餐升级申请的用户
    When 用户打开首页或套餐页
    Then 首页横幅显示 "Free · 1000 / 1000 free scans left"，套餐页当前套餐卡显示 "Free" 与 Sign-in bonus 角标
    And 套餐目录中 Kinder 不标记为当前套餐，Kinder、Starter、Intermediate、Advance 均显示 "Upgrade"
    And 申请 Kinder 被接受（不返回 plan.not_upgrade）

  Scenario: AC-FR-SYS-014-01 LINE 注册信息录入
    Given 一个尚未注册的 LINE 账号完成 LINE 认证
    Then 系统弹出注册信息框，手机号预填且只读，邮箱、昵称与头像预填且可修改，并提供验证码输入框
    When 用户修改邮箱、昵称或头像，向该邮箱发送验证码并输入验证码后点击注册
    Then 系统完成注册，保存修改后的邮箱、昵称与头像，并继续进入应用

  Scenario: AC-FR-SYS-014-02 注册邮箱与验证码校验
    Given LINE 未提供邮箱，或用户修改了预填邮箱
    When 用户未填写邮箱或填写格式错误的邮箱并点击注册
    Then 系统提示邮箱必填或格式错误，不完成注册
    When 用户未向当前填写的邮箱发送验证码，或未输入验证码并点击注册
    Then 系统提示先发送验证码或验证码必填，不完成注册
    When 用户向有效邮箱发送验证码、输入验证码并提交
    Then 系统完成注册并保存该邮箱（生产环境校验验证码，开发环境不校验）

  Scenario: AC-FR-SYS-014-03 取消注册与已注册用户登录
    Given 注册信息框已弹出
    When 用户点击取消
    Then 本次会话被撤销并回到登录页
    Given 已注册用户修改过昵称与头像
    When 用户再次通过 LINE 登录
    Then 昵称与头像保持用户修改后的值，不再弹出注册信息框

  Scenario: AC-FR-SYS-015-01 修改昵称与头像
    Given 已登录用户在个人中心
    When 用户点击资料卡，修改昵称或头像并保存
    Then 个人中心立即显示新的昵称与头像；昵称为空时不可保存

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

  Scenario: AC-FR-SYS-017-01 工作空间刷新后保持
    Given 已登录用户在首页将工作空间切换为已认证企业
    When 用户刷新页面或重新登录
    Then 当前工作空间仍为该企业
    And 若该企业已解绑或不再可用，则回落为个人空间

  Scenario: AC-FR-SYS-017-02 个人与企业数据隔离、企业成员共享
    Given 用户 A（企业 OWNER）与用户 B（企业 MEMBER）各有个人任务，并各在企业空间有任务
    When A 处于个人空间
    Then 首页最近任务与历史页仅显示 A 的个人任务
    When A 或 B 切换到企业空间
    Then 仅显示该企业空间的任务，且包含 A 与 B 在企业空间创建的任务

  Scenario: AC-FR-SYS-017-03 企业空间单独购买套餐
    Given 企业空间未开通付费套餐，企业 OWNER 处于企业空间
    When OWNER 在套餐页申请升级 Kinder 并确认
    Then 创建归属该企业的 PLAN_UPGRADE 申请，个人空间的订阅状态不变
    And 该企业的 MEMBER 在套餐页看到同一处理中申请，但不能提交升级
    When 后台批准该申请
    Then 该企业全体成员在企业空间看到 Kinder 套餐及共享的本月剩余页数，个人空间仍为 Free
```

## 6. 可追溯性
| FR ID | 验证方式 | 设计引用 |
|-------|----------|----------|
| FR-SYS-001..017 | AC-FR-SYS-* | `DM-User`、`DM-Role`、`DM-OperationLog`、`DM-Settings`、`API-8`；FR-SYS-012/013/017：`GET /api/v1/me/subscription?workspace_type&enterprise_id`、`POST /api/v1/me/plan-applications`（`workspace_type`/`enterprise_id`）、`GET /api/v1/me/quota`、`GET /api/v1/ocr/jobs?workspace_type&enterprise_id`、`applications.target_enterprise_id`；FR-SYS-014/015/016：`POST /api/v1/me/registration`、`PATCH /api/v1/me`、`POST /api/v1/me/email/code`、`POST /api/v1/me/email`、`DM-User`（`phone`/`email`/`registered_at`）、`email_verification_codes` |

## 版本历史
| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
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
