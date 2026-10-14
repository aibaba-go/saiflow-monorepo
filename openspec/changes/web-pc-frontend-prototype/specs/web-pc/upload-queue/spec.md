# Delta Spec: web-pc/upload-queue

## Purpose

为 Web PC 前端原型提供单据导入与批量上传工作台：文件选择、格式校验与上传状态队列，全部由 Mock 数据驱动，用于评审上传流程的界面交互。预处理与 OCR 由 Mock 流程模拟。

## ADDED Requirements

### Requirement: 文件导入与格式校验

系统 SHALL 提供文件选择入口（本地文件/扫描仪导入），仅接受 JPG、PNG、PDF 三种格式，单文件不超过 20 MB。不支持的格式或超限文件 SHALL 被拒绝，并以本地化错误消息提示（如 "Unsupported file type"），不得进入队列。（来源：FR-UPLOAD-002/003/004）

#### Scenario: 支持的文件入队

- **WHEN** 用户选择 `invoice.pdf` 并提交上传
- **THEN** 该文件出现在上传队列中，状态为排队/上传中

#### Scenario: 拒绝不支持的格式

- **WHEN** 用户选择 `invoice.docx` 并提交上传
- **THEN** 系统拒绝该文件，显示本地化错误 "Unsupported file type"，队列中不出现该文件

#### Scenario: 拒绝超过大小限制的文件

- **WHEN** 用户选择一个 30 MB 的 PNG 文件并提交上传
- **THEN** 系统拒绝该文件并提示大小超限错误

### Requirement: 批量上传

系统 SHALL 支持一次操作选择多个文件批量上传，全部文件 SHALL 同时进入队列并逐一显示状态。（来源：FR-UPLOAD-005）

#### Scenario: 一次选择多个文件全部入队

- **WHEN** 用户一次选择 10 个图像文件并提交
- **THEN** 队列中显示全部 10 个文件及其各自的上传状态

### Requirement: 上传状态队列

系统 SHALL 在队列中对每个文件显示状态（排队中、上传中、预处理中、OCR 处理中、已完成、失败）及进度反馈。原型 SHALL 以 Mock 数据模拟状态自动流转；处理完成的文件 SHALL 可跳转到核验工作台。（来源：FR-UPLOAD-010）

#### Scenario: 队列状态实时更新

- **WHEN** 一个文件完成 Mock 上传并进入预处理
- **THEN** 该文件的队列状态从"上传中"变为"预处理中"，随后变为"OCR 处理中"直至"已完成"

#### Scenario: 失败状态可见

- **WHEN** 某文件在 Mock 流程中被置为失败
- **THEN** 队列中该文件显示失败状态与重试入口

#### Scenario: 完成后进入核验

- **WHEN** 用户点击一个"已完成"文件的查看入口
- **THEN** 系统打开核验工作台并定位到该单据
