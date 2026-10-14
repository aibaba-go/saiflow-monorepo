---
doc_id: TPL-05
title: "模板 — API 规范"
type: standard
status: active
version: 1.0.2
updated: 2026-10-02
---

# 模板 — API 规范

> 一个服务 API 使用一份文件。每个端点均有稳定的 `API-N` ID 和完整契约：方法、路径、认证、请求、响应和错误。

```markdown
---
doc_id: API-NNN
title: "API 规范 — <服务>"
type: api
status: draft
version: 0.1.0
updated: YYYY-MM-DD
owner: <团队>
---

# API 规范 — <服务>

## 0. 约定
- 基础 URL：`/api/v1`    认证：`Bearer <token>`    Content-Type：`application/json`
- 错误封装：`{ "error": { "code": "...", "message": "...", "details": {} } }`

## API-1 — <端点名称>
| | |
|---|---|
| **方法 / 路径** | `POST /documents` |
| **用途** | … |
| **认证 / 角色** | clerk+ |
| **实现的需求** | FR-UPLOAD-001 |

**请求**
```json
{ "file": "<binary>", "doc_type": "PO" }
```

**响应 200**
```json
{ "document_id": "uuid", "status": "processing" }
```

**错误**
| HTTP | 代码 | 触发条件 |
|------|------|----------|
| 400 | invalid_format | 文件类型不受支持 |
| 401 | unauthorized | 缺失或无效的 token |

## 版本历史
| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
```

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.0.2 | 2026-10-02 | Product Engineering | 完成模板面向读者内容的第二轮中文化 |
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容翻译为简体中文 |
| 1.0.0 | 2026-09-10 | Product Engineering | 初始 API 规范模板 |
