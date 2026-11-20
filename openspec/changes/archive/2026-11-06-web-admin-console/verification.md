# web-admin-console 验证记录

## 1. 自动化测试

- **后端：** `pytest -q` **509 passed**，ruff 无告警（本机 Docker PostgreSQL 18，`REQUIRE_INTEGRATION=1`，接口测试以应用账号运行）。
- **admin 后台（apps/web-admin）：** `pnpm test` **55 passed**（Vitest + React Testing Library）；`pnpm lint`、`pnpm build` 通过。
- **其他前端：** line-mini 113、web-pc 5、api-client 5，全部通过。后来 line-mini 加了 S 级修复，变为 115 条，见 §3。
- **脚本与契约：** `scripts/tests/*.test.sh` 共 10 项通过；接口契约重新生成后与提交一致；`openspec validate web-admin-console` 通过。
- **CI：** 提交 `eebefe2` 的 CI 通过。第一次运行时，line-mini 有一条不稳定的旧测试失败（049-03，与本变更无关），重跑后通过。

## 2. 验收标准 → 测试

下表的前端测试在 `apps/web-admin/src/` 下，后端测试在 `services/api/tests/integration/` 下。

| 需求 | 验收标准 | 测试 |
|---|---|---|
| FR-SYS-019（修改）admin 账号、修改本人口令 | 019-09、10 | `test_admin_password.py`（修改成功、校验、输错计入锁定、锁定期间拒绝、须 admin 会话）；019-01～08 仍由原有测试覆盖 |
| FR-SYS-003（修改）操作日志查询 | 003-07、08 | `test_admin_audit_query.py`（倒序分页、筛选、前缀中的通配符按字面、参数错误 400、仅 admin）；003-01～06 仍由原有测试覆盖 |
| FR-SYS-080 后台查询用户 | 080-01～03 | `test_admin_user_search.py` |
| FR-SYS-005 OCR 引擎与大模型配置 | 005-01～05 | `test_ocr_settings.py`（默认值与密钥状态、只改一项、校验、主备切换、读取接口与回退默认值、仅 admin、应用账号可读） |
| FR-SYS-060 登录、会话与首页 | 060-01～04 | `auth/auth.test.tsx`（登录退出、口令错误、过期回到原页、使用中过期的提示、不跟随外部 next）；`pages/applications.test.tsx`（首页待办数） |
| FR-SYS-061 修改本人口令 | 061-01～02 | `pages/people.test.tsx` |
| FR-SYS-062 界面语言 | 062-01～02 | `stores/language.test.ts`、`i18n/i18n.test.ts` |
| FR-SYS-063 建组织申请审批 | 063-01～02 | `applications.test.tsx` |
| FR-SYS-064 组织管理 | 064-01～03 | `pages/organizations.test.tsx` |
| FR-SYS-065 企业认证审核 | 065-01 | `applications.test.tsx` |
| FR-SYS-066 订阅与预占 | 066-01～03 | `organizations.test.tsx`（须先确认） |
| FR-SYS-067 续费与开通申请审批 | 067-01～02 | `applications.test.tsx` |
| FR-SYS-068 套餐目录与价格 | 068-01～03 | `pages/catalog.test.tsx` |
| FR-SYS-069 系统参数 | 069-01～02 | `catalog.test.tsx`（须先确认） |
| FR-SYS-070 查询用户 | 070-01～02 | `people.test.tsx` |
| FR-SYS-071 操作日志 | 071-01～02 | `people.test.tsx` |
| FR-SYS-072 OCR 与大模型配置 | 072-01～02 | `catalog.test.tsx` |
| FR-SYS-073 等待、确认与错误反馈 | 073-01～02 | `applications.test.tsx`、`components/ConfirmButton.test.tsx`、`hooks/useSubmit.test.tsx` |

## 3. 部署与浏览器实测（2026-11-06）

| 部署 | 提交 | 说明 |
|---|---|---|
| Deploy 42130998884 | `eebefe2` | 执行迁移 0007 → 0008，写入 7 条 OCR 与大模型配置默认值；三个站点健康检查正常 |

负责人在浏览器实测（`https://saiflow-admin.aibaba.asia`）：

| 项目 | 结果 |
|---|---|
| 1. 登录和退出 | 通过 |
| 2. 中英文切换 | 通过 |
| 3. 批准建组织申请（LINE 小程序提交"测试组织02"，后台批准，小程序显示"已批准"） | 通过。第一次手机网络问题导致小程序打不开，恢复后通过。另发现小程序的租户切换列表不会刷新，见下文 |
| 4. 套餐申请批准（租户 #76 出现在"已批准"中） | 通过 |
| 5. 修改套餐价格 | 通过 |
| 6. 按邮箱查询用户 | 通过。第一次查询没有结果，原因是邮箱输错了 |
| 7. 查看操作日志（抽查记录与操作一致） | 通过 |
| 8. 查看并保存 OCR 配置（单据重试次数、切换阈值） | 通过 |
| 9. 修改本人口令：新口令能登录，旧口令登录失败 | 通过 |

**实测中发现的 B-5a 问题（S 级修复）：** 小程序只在打开时读取一次本人的租户列表。在小程序打开期间，后台批准的组织不会出现在租户切换里，与 AC-FR-SYS-047-04 不符。修复为每次打开租户切换时重新读取列表，读取失败时保留原列表（`0468ef9`，`features/tenants/tenants.test.tsx` 的复现测试先失败、修复后通过；line-mini 115 passed）。负责人确认后随下次部署上线。

## 4. 最终审查

独立审查员（Opus）检查了整个分支：0 Critical、4 Important、5 Minor。

### 已修复（每项都先复现失败，修复后通过）

1. 会话在使用中过期时，页面停在空白处。现在会回到登录页并提示"登录已过期"，登录后回到原来的页面。
2. 账号锁定期间，仍能在修改密码页继续尝试当前口令。现在锁定期间直接拒绝。
3. 设定订阅前没有确认步骤。
4. 修改系统参数前没有确认步骤。

### 实现中的决定

- 修改口令时输错当前口令，计入与登录相同的 5 次锁定，但不单独写操作日志；第 5 次触发锁定时写 `admin.lock`。
- 后台所有时间都按曼谷时间显示和填写，以 `+07:00` 发送。
- 套餐规则、OCR 参数只在后端校验，前端把字段错误显示在对应输入框下面。
- 套餐的成员人数上限留空表示不限。
- 申请人和租户显示为"用户 #id / 租户 #id"，因为列表接口只返回 id。

### 暂不处理的 Minor

- 操作日志的"操作者类型""结果"显示英文原值；OCR 页有一处写死的 "LLM" 标签。
- 操作日志的结束时间出错时，错误没有显示在输入框下面。用日期选择器操作不会出现这种情况。
- 操作日志没有"上一页"，只有"回到最新"和"下一页"。
- 切换审批列表的标签后，上一个标签的错误提示仍然留着。
- 操作日志的结束时间不包含所选的那一分钟。
- line-mini `orgs.test` 049-03 在 CI 上偶尔失败：上一条测试的对话框还在关闭时，页面上会出现两个确认按钮。
