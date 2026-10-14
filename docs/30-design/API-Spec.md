---
doc_id: DES-003
title: "SaiFlow — API 规范"
type: api
status: active
version: 1.2.2
updated: 2026-10-12
owner: Product Engineering
source: "EPIC-01..EPIC-08"
related: [DM-Document, DM-ExtractionPayload, DM-ConversionJob, DM-DocumentTemplate, DM-ExtractedField, DM-ExportJob]
doc_source: generated
generated_by: "OpenAPI → openspec sync"
---

# SaiFlow — API 规范

> 本文件由 **后端 OpenAPI → OpenSpec sync** 自动生成。
> 禁止手工编辑；如需修改接口定义，请更新 `services/api/app/routers/` 与 `services/api/app/schemas/` 中的对应代码。

## 状态

项目尚未正式启动，后端 OpenAPI 契约尚未生成。本文件将在 `services/api/` 完成首个端点实现后，通过 OpenSpec 同步流程自动填充。

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.2.2 | 2026-10-12 | Product Engineering | 清空设计内容，待项目启动后由后端 OpenAPI 自动生成 |
| 1.2.1 | 2026-10-12 | Product Engineering | 声明 `doc_source: generated`，在正文顶部增加自动生成警告框，明确后端 OpenAPI 为唯一来源 |
| 1.2.0 | 2026-10-07 | Product Engineering | 更新上传/批次处理链路并新增 API-10 文档格式模板配置接口 |
| 1.1.0 | 2026-10-06 | Product Engineering | 新增 API-4c 固定层级复核策略与复核决定接口；明确不支持任意工作流编排 |
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容翻译为简体中文 |
| 1.0.0 | 2026-09-10 | Product Engineering | V1.0 初始本地 API 契约（含 V2.0/V3.0 适配器存根） |
