# Delta Spec: web-pc/verification-workbench

## MODIFIED Requirements

### Requirement: 并排展示核验视图

系统 SHALL 对每份待核验单据并排展示原图与 OCR 提取结果：头部字段（如单据编号、日期、企业、金额）与行项目表，每个字段 SHALL 显示其置信度。原图 SHALL 位于核验视图左侧固定栏，在用户滚动查看头部字段与行项目时 SHALL 保持可见（sticky）；行项目表 SHALL 与原图同屏可见。（来源：FR-VERIFY-001、FR-OCR-012/010）

#### Scenario: 打开核验视图

- **WHEN** 用户从队列或列表打开一份已完成 OCR 的 Invoice
- **THEN** 页面左侧显示原图，右侧显示头部字段与行项目表，每字段带置信度

#### Scenario: 核对行项目时原图保持可见

- **WHEN** 用户在核验视图中向下滚动到行项目表逐行核对数量与金额
- **THEN** 原图仍固定显示在左侧，无需滚动页面即可同时看到原图与行项目
