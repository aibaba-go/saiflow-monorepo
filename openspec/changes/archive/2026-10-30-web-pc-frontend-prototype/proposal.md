# 提案：Web PC 前端原型（web-pc-frontend-prototype）

## Why

SaiFlow V1.0 的 P0 核心闭环（上传 → OCR 核验 → Excel 录入/归档 → 归档管理）目前只有需求与设计文档，`apps/web-pc/` 仍为空目录，没有任何可运行、可评审的界面。为了让产品/需求方在真实浏览器中走通并评审核心单据处理流程、统一 UI 结构与交互方式（并尽早暴露 Ant Design 布局与 i18n 方案的问题），需要先交付一个**可运行的前端骨架 + Mock 数据**原型。

产品诉求来源：`docs/10-product/PRD-SaiFlow.md` §4.1–§4.6；`docs/10-product/Vision-Scope.md` §3.1（V1.0 P0 范围）；`docs/20-requirements/Requirements-Index.md`（EPIC-01/03/04/05/06）。

## What Changes

- 新建 `apps/web-pc/` React + TypeScript + Vite + Ant Design 工程（技术栈已由 `docs/30-design/Architecture.md` 确定），作为可独立启动的前端原型。
- 建立 Mock 数据层（本地 mock 模块，模拟 OCR 结果、置信度、复核状态、归档记录等），**不依赖真实后端**；API 调用边界与未来 `packages/api-client` 对齐，后续可整体替换为真实客户端。
- 实现以下页面/流程（P0 核心闭环 + 2 个关键 P1 页面）：
  - 登录与全局框架：登录页、应用布局/导航、语言切换（FR-SYS-001/002/004）
  - 上传工作台：本地/扫描仪文件导入（JPG/PNG/PDF）、批量上传、上传状态队列（FR-UPLOAD-002/003/005/010）
  - 核验工作台：原图与 OCR 结果并排展示、单字段编辑、低置信度红色标记、缺失字段提醒、确认锁定、变更日志、复核门控与待复核列表（FR-VERIFY-001/002/004/005/006/007/009/011/012）
  - 批量更正（关键 P1）：多份单据间批量字段更正（FR-VERIFY-003）
  - Excel 录入与归档：生成模板、一键填充、导出、归档设置（FR-ENTRY-001/002/003/004/005）
  - 归档管理：归档记录分类浏览、文档预览（FR-MGMT-001/006）
  - 归档搜索（关键 P1）：按编号/日期/企业/类型搜索（FR-MGMT-002/003/004/005）
  - 系统设置与操作日志：参数配置、复核策略、操作日志查看（FR-SYS-003/005）
- 所有 UI 文案外置化资源包（NFR-I18N-003），默认 THB 货币格式（NFR-I18N-004）。
- 本变更**不触碰** `services/`、`apps/line-mini/` 与任何真实云资源。

## Capabilities

### New Capabilities

（`openspec/specs/` 目前为空，以下均为新建能力；路径采用 `web-pc/` 前缀组织。）

- `web-pc/shell-auth`: 登录、全局布局与导航、语言切换（Mock 会话）
- `web-pc/upload-queue`: 文件导入、批量上传与上传状态队列页面
- `web-pc/verification-workbench`: 并排核验、字段编辑、复核门控与变更日志工作台；含批量更正（P1）
- `web-pc/entry-archiving`: Excel 模板生成、一键填充、导出与归档配置页面
- `web-pc/archive-browser`: 归档记录分类浏览、文档预览与搜索（P1）
- `web-pc/settings-admin`: 系统参数/复核策略配置与操作日志查看

### Modified Capabilities

无（`openspec/specs/` 尚无既有能力）。

## Impact

- **代码**：`apps/web-pc/`（全新，主要落点）；可能少量涉及 `packages/ui/`（主题/布局常量，具体在 design.md 决定）。不修改 `services/`、`apps/line-mini/`。
- **依赖**：新增前端依赖 react、antd、react-router、vitest 等（由 pnpm workspace 管理，仅 glob `apps/*`、`packages/*`，不破坏命令隔离）。
- **API**：无真实 API 变更；Mock 层模拟 `docs/30-design/API-Spec.md` 中的端点契约（API-1/4/5/7/8），仅用于界面驱动。
- **规格注记**：本变更为原型，验收标准在 **UI 层** 以 Mock 数据验证（如"确认后单据状态在界面显示为已锁定"），不验证真实后端行为；真实行为契约归后续后端/正式前端变更。

## Non-goals（非目标）

- 不接入真实后端、真实 OCR（TextIn）、Cloud SQL/GCS/Firestore/Cloud Functions。
- 不实现 `apps/line-mini`（Line MiniApp）。
- 不实现真实账户体系/安全（登录仅为 Mock 会话，不做真实鉴权、加密与账户锁定 FR-SYS-007）。
- 不实现 V1.0 范围外的 P1/P2 功能：ERP 对接（FR-ENTRY-010..012）、PDF 账单包合并（FR-ENTRY-009）、云端文件夹归档（FR-ENTRY-014）、重复检测/去重（FR-MGMT-009/010）、关键词全文搜索（FR-MGMT-008）、边界框高亮（FR-VERIFY-008）、运营报表（EPIC-07）、模板配置（EPIC-08）。
- 不做生产部署（Cloud Run Docker 化）与性能/安全测试。
- 移动端相机上传（FR-UPLOAD-001）属移动端入口，不在 PC 原型内。
