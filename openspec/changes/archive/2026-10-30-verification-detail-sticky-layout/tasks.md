# Tasks: verification-detail-sticky-layout

## 1. 核验工作台布局重构

- [x] 1.1 将行项目表列定义从 `VerificationPage.tsx` 抽出为可共享的 `lineItemColumns(t)`（`features/verification/meta.tsx` 或独立模块），核验页行为不变；验证：`pnpm exec vitest run src/features/verification` 全绿
- [x] 1.2 重构 `VerificationPage` 详情布局：左栏原图（span 6，sticky top 80px），右栏上部头部字段、下部行项目表（span 18）；验证：核验视图与归档预览的行项目均在右栏渲染，原图容器与行项目表同属一个 Row

## 2. 归档预览同步

- [x] 2.1 重构 `ArchiveBrowserPage` 预览为同一骨架（sticky 左图 span 6 + 右栏只读字段 span 18），并新增只读行项目表（复用 `lineItemColumns(t)`，数据源 `line_items` 按 `document_id` 过滤）；验证：打开 doc-ar-01 预览可见行项目与原图同屏

## 3. 验证与收尾

- [x] 3.1 新增/调整断言：核验视图与预览页的行项目-原图同屏断言 + 现有测试回归全绿；验证：`pnpm exec vitest run` 全部通过
- [x] 3.2 质量门：`pnpm --filter @saiflow/web-pc build`、`lint` 全绿，根 `pnpm build` 不失败；`openspec validate verification-detail-sticky-layout` 通过
