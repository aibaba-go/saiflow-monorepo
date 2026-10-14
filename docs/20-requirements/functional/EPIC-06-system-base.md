---
doc_id: EPIC-06
title: "EPIC-06 — 基础系统（账户、权限、配置、i18n）"
type: epic
status: active
version: 1.1.0
updated: 2026-10-06
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
| FR-SYS-001 | 支持用户注册和登录（本地账户） | P0 | §4.6 | — | AC-FR-SYS-001-01/02 |
| FR-SYS-002 | 强制实施基于角色的访问权限 | P0 | §4.6 | FR-SYS-001 | AC-FR-SYS-002-01 |
| FR-SYS-003 | 为每个改变状态的操作记录操作日志 | P0 | §4.6,§5.3 | FR-SYS-001 | AC-FR-SYS-003-01 |
| FR-SYS-004 | 允许在泰语 / 英语 / 中文之间切换 UI 语言 | P0 | §4.6 | — | AC-FR-SYS-004-01 |
| FR-SYS-005 | 提供基础参数配置（路径、阈值、模板） | P0 | §4.6 | FR-SYS-002 | AC-FR-SYS-005-01 |
| FR-SYS-006 | 提供归档与存储设置（GCS 对象前缀、命名规则） | P0 | §4.6 | FR-SYS-002 | AC-FR-SYS-006-01 |
| FR-SYS-009 | 允许管理员为角色授予复核与报表查看权限 | P0 | PRD §1.2, §4.6 | FR-SYS-002 | AC-FR-SYS-009-01 |
| FR-SYS-007 | 重复登录失败后锁定账户 | P1 | §5.3 | FR-SYS-001 | AC-FR-SYS-007-01 |
| FR-SYS-008 | 保留每位用户的偏好（语言、默认导出路径） | P1 | §4.6 | FR-SYS-001 | AC-FR-SYS-008-01 |

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

## 4. 规则
- **密码：** 使用强单向哈希（例如 bcrypt/argon2）存储；绝不存储明文（见 `NFR-SEC`）。
- **操作日志（FR-SYS-003）：** 仅可追加；采集 `user`、`action`、`target`、`timestamp`、`result`。用于可追溯性和防篡改证据。
- **语言（FR-SYS-004）：** 默认 = 泰语；切换立即生效且无需重启；所有面向用户的字符串均外部化（i18n 资源包）。
- **配置（FR-SYS-005/006）：** 变更需要 `admin`；变更会被记录。

## 5. 代表性验收标准

```gherkin
Feature: EPIC-06 基础系统

  Scenario: AC-FR-SYS-001-01 登录成功
    Given 已注册且具有有效凭据的用户
    When 用户登录
    Then 系统 SHALL 创建会话并授予该用户的角色权限

  Scenario: AC-FR-SYS-002-01 权限强制执行
    Given 角色为 "viewer" 的用户
    When 用户尝试导出数据
    Then 系统 SHALL 拒绝该操作并记录该次尝试

  Scenario: AC-FR-SYS-004-01 语言切换
    Given UI 当前为泰语
    When 用户将语言切换为英语
    Then 所有 UI 标签更新为英语，且无需重启应用
```

## 6. 可追溯性
| FR ID | 验证方式 | 设计引用 |
|-------|----------|----------|
| FR-SYS-001..009 | AC-FR-SYS-* | `DM-User`、`DM-Role`、`DM-OperationLog`、`DM-Settings`、`API-8` |

## 版本历史
| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.1.0 | 2026-10-06 | Product Engineering | 新增复核与报表查看权限配置，并将存储设置同步为 GCS 架构 |
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容与验收场景翻译为简体中文 |
| 1.0.0 | 2026-09-10 | Product Engineering | 根据 PRD 第 4.6 节生成初始基础系统需求 |
