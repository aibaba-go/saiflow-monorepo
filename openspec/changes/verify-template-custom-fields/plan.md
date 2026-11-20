# 模板结果额外普通字段实施方案

## 范围和授权
以本 change 的 results/web-pc/line-mini delta 为唯一行为依据：FR-VERIFY-015、FR-SYS-129/105/107/120。2026-11-09 负责人授权自主选择并实施，无额外确认关卡。遵循 STD-005/006。普通字段仅结果级，不更新模板，不扩展 XLSX 输出，mini 不提供模板额外字段增删。

## 已观察实现与方案
后端 result_service 和 normalize.fill_structure 已保留未知字段；不需要新接口或数据库迁移。PC EditableResult 模板分支只读定义；使用定义字段键与当前分组键并集检测重复，模板普通字段→额外普通字段→明细表顺序展示。新增沿用现有 AddField，初值空字符串；删除只允许未定义字段。mini StructuredDataView 的 templateView 接收当前 value，追加未定义字段，标记 owned=true 防止模板模式增删，但仍受 editable 控制值编辑。数字按字符串保留。检查 ResultPage 的 edit 权限，最终与复核仍 readonly。

## 任务（每项包括测试）
- [x] PC 模板分组新增/显示/删除额外字段；ocr 测试覆盖空白、重复定义表键/已存/未存、跨组同名、取消、删除保护、readonly、三语和精度。
- [x] mini 模板视图追加额外字段并保持原值与只读/可编辑边界；StructuredDataView 和结果/最终/复核测试覆盖新增 delta AC。
- [x] 后端隔离 integration 测试覆盖保存新版本、重新读取、删除、不变保存、必填/锁定/权限；不改变导出模板范围。
- [x] 运行受影响及全量测试，浏览器检查新增和保存，审查改动；证据写 verification.md，未覆盖的真实环境项明确列出。

## 检查点
只有全部规定行为及对应测试通过才勾选任务；无法验证的真实第三方流程不勾选全面完成，不删改原断言来迁就实现。不提交、不部署，不改共享恢复库。
