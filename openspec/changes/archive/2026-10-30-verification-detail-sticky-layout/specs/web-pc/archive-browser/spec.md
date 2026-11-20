# Delta Spec: web-pc/archive-browser

## MODIFIED Requirements

### Requirement: 文档预览

系统 SHALL 提供归档单据预览：并排展示原始图像与提取数据（只读），提取数据区 SHALL 包含头部字段与行项目表，且原图在滚动查看提取数据时 SHALL 保持可见（sticky）；从预览 SHALL 可查看该单据的变更日志与复核记录。（来源：FR-MGMT-006）

#### Scenario: 打开预览

- **WHEN** 用户在列表中点击一条归档单据
- **THEN** 预览页并排展示原图与提取数据（含行项目），并可切换查看变更/复核日志

#### Scenario: 预览中查看行项目

- **WHEN** 用户在预览页滚动到提取数据区的行项目表
- **THEN** 原图仍固定显示在左侧，行项目与原图同屏可见
