# Proposal: verification-detail-sticky-layout

## Why

核验工作台的行项目表目前渲染在「原图/头部字段」区下方、整页最底部，核验行项目（数量/单价/行小计）时原图已随页面滚出视野，FR-VERIFY-001「识别字段与其源图像区域并排显示」在行项目维度上没有真正成立。这是当前原型（`web-pc-frontend-prototype`）交付后走查暴露的第一个布局级体验缺口。

## What Changes

- 核验详情视图重构为「左侧原图（sticky 随滚动固定）+ 右侧上下两块（头部字段 / 行项目表）」的骨架：滚动字段与行项目时原图保持可见（来源：`docs/20-requirements/functional/EPIC-03-data-verification.md` FR-VERIFY-001，P0）。
- 行项目表从整页全宽（span 24）移入右栏（span 18），保留全部列。
- 归档浏览的文档预览页（`ArchiveBrowserPage`）同步同一骨架并补充行项目表（当前预览页缺失行项目，只读展示），保持两处「查看单据」形态一致。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `web-pc/verification-workbench`: 「并排展示核验视图」要求收紧——原图在核验视图滚动（字段编辑、行项目核对）时 SHALL 保持可见；行项目表 SHALL 与原图同屏可见。
- `web-pc/archive-browser`: 「文档预览」要求扩展——预览页除原图与提取数据外 SHALL 同时展示行项目，并采用与核验工作台一致的并排骨架。

## Impact

- `apps/web-pc/src/features/verification/VerificationPage.tsx`：详情布局段落（Row/Col 结构 + sticky 样式），无逻辑变更。
- `apps/web-pc/src/features/archive/ArchiveBrowserPage.tsx`：预览布局段落 + 新增只读行项目表（复用核验页列定义）。
- 无 API / Mock 数据 / 类型 / 依赖变更；现有测试按文本与角色定位，不依赖 DOM 列结构，预期零测试改动（新增 1 条布局断言）。

## Non-goals

- 不实现 FR-VERIFY-008（选中字段高亮源边界框，P1）。
- 不改动行项目表的列定义、置信度标记逻辑与门控行为。
- 不涉及 apps/line-mini。
