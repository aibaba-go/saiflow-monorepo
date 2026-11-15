# web-admin Spec Delta

## MODIFIED Requirements

### Requirement: FR-SYS-072 OCR 与大模型配置
admin SHALL 可以查看并修改 OCR 与大模型配置（FR-SYS-005）：首选引擎、备用引擎、单据重试次数、全局切换阈值、首选引擎试探间隔、大模型地址与模型名称。页面 SHALL 显示每项密钥"已配置"或"未配置"，SHALL NOT 显示密钥本身，SHALL 说明密钥在服务器的环境变量文件中修改。保存前 SHALL 确认。

#### Scenario: AC-FR-SYS-072-01 查看与修改
- **GIVEN** 默认配置
- **WHEN** admin 打开配置页，把单据重试次数改为 2，确认后保存
- **THEN** 页面先显示首选 TextIn、备用 Google Document AI OCR、重试 3 次等默认值与 TextIn、Google Document AI OCR、大模型各自的配置状态；保存后显示重试 2 次；页面不再出现 Google Cloud Vision

#### Scenario: AC-FR-SYS-072-02 校验
- **GIVEN** 配置页
- **WHEN** 把首选与备用设为同一引擎，或把大模型地址填为 http 开头的地址
- **THEN** 对应输入框下显示错误提示，配置不变

### Requirement: FR-SYS-162 默认 OCR 选择与备用联动
后台 SHALL 将首选引擎明确为默认 OCR，说明备用只按 FR-OCR-021 的失败/切换规则使用，并支持 TextIn 与 Google Document AI OCR 双向选择。首选切至当前备用时 SHALL 将备用改为原首选；备用“不使用” SHALL 保持不使用。联动只修改待保存表单，经确认后提交全部变动字段；初始默认、系统共用范围、后端整体校验及密钥规则 SHALL 仍服从 FR-SYS-005/072/073。

#### Scenario: AC-FR-SYS-162-01 切换为 Vision 默认
- **GIVEN** 已保存首选 TextIn、备用 Google Document AI OCR
- **WHEN** admin 选择默认 Google Document AI OCR
- **THEN** 表单显示默认 Google Document AI OCR、备用 TextIn，并说明默认及失败备用的含义；确认保存前不发送配置修改
- **WHEN** admin 确认保存并重新打开页面
- **THEN** 同一请求提交两个变动引擎字段，重新读取显示默认 Google Document AI OCR、备用 TextIn，其他参数不被重置

#### Scenario: AC-FR-SYS-162-02 反向交换
- **GIVEN** 已保存首选 Google Document AI OCR、备用 TextIn
- **WHEN** admin 选择默认 TextIn 并确认保存
- **THEN** 备用同步为 Google Document AI OCR，提交两个引擎字段并持久化；没有同引擎冲突

#### Scenario: AC-FR-SYS-162-03 不使用备用与取消
- **GIVEN** 当前备用为“不使用”，表单还修改了模型名称
- **WHEN** 切换默认引擎，然后取消保存确认
- **THEN** 表单中的备用仍为“不使用”，模型输入保留；没有 PATCH，已保存配置不变

#### Scenario: AC-FR-SYS-162-04 失败与整体校验
- **GIVEN** 表单手动将备用设为首选，或其他字段非法
- **WHEN** admin 确认保存，后端返回指出字段的 400
- **THEN** 配置整体不变，对应字段显示错误且输入保留；不会通过去掉错误字段或重复提交绕过后端校验

#### Scenario: AC-FR-SYS-162-05 双语与凭据
- **GIVEN** admin 在配置页，响应包含密钥配置状态
- **WHEN** 切换中文与英文，修改默认 OCR 或等待保存
- **THEN** 默认/备用说明及错误都有译文；仅显示密钥是否配置，不显示密钥值、凭据路径或处理器编号；等待期间不重复提交，不因选择默认而改变服务器环境变量
