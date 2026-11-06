# ocr-scan-flow 验证记录

## 1. 自动化测试

- **后端：** `pytest -q` **810 passed**，ruff 无告警（本机 Docker PostgreSQL，`REQUIRE_INTEGRATION=1`，接口测试以应用账号运行）。这个数字包含后续 `ocr-ui-parity` 的测试；本变更结束时（最终评审修复后）为 733 passed。
- **前端：** line-mini 166、web-pc 73、web-admin 55、api-client 5，全部通过；`pnpm -r lint`、`pnpm -r build` 通过。
- **脚本与契约：** `scripts/tests/*.test.sh` 全部通过（compose 检查 78 项、secrets 整理 15 项）；接口契约重新生成后与提交一致；`openspec validate ocr-scan-flow` 通过。
- **CI：** 每次部署前对应提交的 CI 都已通过。

## 2. 验收标准 → 测试

后端测试在 `services/api/tests/` 下，前端测试在 `apps/line-mini/src/features/scan/` 下。

| 能力 | 需求 | 测试 |
|---|---|---|
| documents | FR-UPLOAD-003、005、006、010、011、013 | `integration/test_uploads.py`、`unit/test_ocr_files.py`（格式、上限、截断、修复过的 PDF、页面预览大小上限、预览在线程中执行） |
| recognition | FR-OCR-017～023、FR-TEMPLATE-006 | `integration/test_ocr_jobs.py`、`test_ocr_worker.py`（预占与退还、重启恢复、意外错误）、`test_template_mapping.py`、`test_ocr_schema.py`、`unit/ocr/*`、`unit/test_cli_ocr_worker.py` |
| results | FR-VERIFY-006、009、015、017 | `integration/test_results.py`（版本、冲突、并发、确认门控、方案 A：只有免费额度的组织可以确认） |
| exports | FR-ENTRY-015 | `integration/test_exports.py`、`unit/ocr/test_xlsx.py`（含导出权限与下载凭证） |
| line-mini | FR-SYS-056～059、105～108 | `home.test.tsx`、`confirm.test.tsx`、`processing.test.tsx`、`result.test.tsx`、`final.test.tsx`、`history.test.tsx`、`features/shell.test.tsx`（这些页面已由 `ocr-ui-parity` 按 main 重写，测试随之改写） |

## 3. 部署后发现并修复的问题

| 问题 | 处理 |
|---|---|
| 容器读不到 GCS 密钥（`Permission denied`） | 密钥文件夹改归容器用户所有；之后改为每次部署自动整理 `secrets` 的所有者与权限（`secrets-perms.sh`，部署说明 §2.10） |
| 没有单据号的 Billing Note 转换失败（`missing: document.billing_no`） | Billing Note 的主要字段改为日期 + 总金额；迁移 0010 写入新版本 |
| 只有免费额度的组织能扫描、不能确认（"套餐已到期"） | 负责人选方案 A：能扫描就能确认（FR-VERIFY-009 修改，新增 AC-FR-VERIFY-009-05） |
| 匹配不到模板时显示"转换失败" | 由 `ocr-ui-parity` 改为直接显示自由格式（D4） |

## 4. 部署与实测（2026-11-06）

| 部署 | 提交 | 说明 |
|---|---|---|
| Deploy 42204747236 | `017d0a4` | 首次发布（迁移 0009）；三个站点健康检查正常，5432 外部不可连 |
| Deploy 42222420539 | `e8b6b19` | 部署时自动整理 secrets 文件夹 |
| Deploy 42227003940 | `ea113e4` | 方案 A 与 Billing Note 主要字段（迁移 0010） |
| Deploy 42245651421 | `dbdb57c` | 与 `ocr-ui-parity` 一同发布（迁移 0011、0012） |

负责人一次性设置：私有存储桶、服务账号密钥、`DOWNLOAD_TICKET_SECRET`、TextIn / Google Vision / 大模型密钥（部署说明 §2.10、§2.8）。

负责人在手机 LINE 中实测：上传并识别一张 Billing Note，发现上面两个问题，已修复并重新部署；按 `ocr-ui-parity` 改版后粗看主流程，负责人确认与之前一致。负责人决定细节不逐项测试（2026-11-06）。

## 5. 遗留事项

- 负责人未逐项实测：游客确认后注册、在 LINE 中导出并在系统浏览器下载、识别中取消、引擎切换。
- 最终评审延后的次要问题：
  - 过期的导出文件与页面预览图不会从存储桶删除（删除待处理记录时，它的预览图也不删除）；
  - 文件头正确但内容截断的 JPEG/PNG 会进入待处理；
  - 规格评审重点 3 中"内容与声明的大小不符"无法测试（接口不接收声明的大小）；
  - 没有"游客识别 → 草稿 → 注册 → 确认"的端到端后端测试（数据归集与小程序流程分别有测试）；
  - 导出文件先写入存储、后提交数据库，提交失败时会留下孤立文件。
