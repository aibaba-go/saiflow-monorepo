---
doc_id: ADR-002
title: "ADR-002 — Web PC 前端原型采用类型化 Mock 适配层"
type: adr
status: proposed
version: 1.0.0
updated: 2026-10-12
owner: Product Engineering
related: [ADR-001, openspec/changes/web-pc-frontend-prototype]
---

# ADR-002 — Web PC 前端原型采用类型化 Mock 适配层

## 状态

建议中（随变更 `web-pc-frontend-prototype` 落地后转为已接受）。

## 背景

- 后端 `services/api` 尚无可调用接口，但产品需要在真实浏览器中评审 P0 核心闭环的界面与流程。
- 架构要求前端 API 调用统一走 `packages/api-client`（OpenAPI 生成），禁止手写第二份 API 契约。
- 核验状态机（0/1/2 级复核）等业务规则必须在演示中真实生效，不能是静态截图。

## 决策

- 页面只依赖类型化的 `ApiClient` 接口（语义对齐 `docs/30-design/API-Spec.md`）。
- 原型阶段默认注入 `MockApiClient`：内存 store + 模拟延迟；会话/语言/设置持久化到 localStorage，单据数据刷新后重置以保证演示确定性。
- 接真实后端时，新增 `RealApiClient`（基于 OpenAPI 生成的 `packages/api-client`）并替换注入，页面代码零改动；`VITE_USE_MOCK` 环境变量控制切换。
- 核验状态机以纯函数模块实现于前端 Mock 层（规则抄自 EPIC-03 §3.1），带单元测试；后端实现后以其为唯一权威并对齐。

## 考虑过的方案

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| MSW（service worker 拦截网络层） | 最贴近真实网络请求 | 原型阶段需额外配置；handler 仍需维护内存状态，收益不足 | 拒绝 |
| 静态 JSON 快照驱动 | 实现最简单 | 无法表达确认锁定、复核流转等状态变化，不满足演示需求 | 拒绝 |
| 类型化 Mock 适配层（ApiClient 接口 + Mock 实现） | 与未来 api-client 替换边界一致；状态机可真实运转；零额外设施 | 接口语义需人工对齐 API-Spec，存在漂移风险 | 采用 |

## 后果

- 漂移风险通过「接口按 API-Spec/Data-Model 命名 + 后续以 OpenAPI 生成物替换」缓解。
- 前端状态机实现是临时权威，后端就绪后必须删除或降级为镜像。

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.0.0 | 2026-10-12 | Product Engineering | 随 `web-pc-frontend-prototype` 变更提出 |
