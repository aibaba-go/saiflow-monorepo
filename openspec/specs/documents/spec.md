# documents Specification

## Purpose
单据原件的上传、校验、保存与读取：支持的格式与上限、分步上传与批量上传、矫正与裁剪、上传状态、原件读取与页面预览、待处理记录，以及按链接导入。

## Requirements

### Requirement: FR-UPLOAD-003 支持的格式与上限
系统 SHALL 接受 JPG、PNG 与 PDF 格式的单据文件，并 SHALL 按文件内容（文件头）判断格式，SHALL NOT 只看扩展名。单个文件 SHALL 不超过 20 MB；PDF SHALL 不超过 50 页，且至少 1 页。不符合时 SHALL 拒绝该文件并指出原因（格式不支持、过大、页数过多、文件损坏），SHALL NOT 保存原件（FR-UPLOAD-004）。

#### Scenario: AC-FR-UPLOAD-003-01 接受三种格式
- **GIVEN** 已登录用户或游客，当前租户可用
- **WHEN** 分别上传一张 JPG、一张 PNG 与一份 3 页的 PDF
- **THEN** 三个文件都上传成功并进入待处理；PDF 记为 3 页，图片记为 1 页

#### Scenario: AC-FR-UPLOAD-003-02 拒绝不支持或伪装的文件
- **GIVEN** 一个扩展名为 `.jpg`、内容实为 ZIP 的文件，以及一个 `.docx` 文件
- **WHEN** 用户上传这两个文件
- **THEN** 都被拒绝，原因为"格式不支持"，不保存原件

#### Scenario: AC-FR-UPLOAD-003-03 超过上限
- **GIVEN** 一个 21 MB 的 PNG，以及一份 51 页的 PDF
- **WHEN** 用户上传
- **THEN** 前者被拒绝，原因为"文件过大"；后者被拒绝，原因为"页数过多"

### Requirement: FR-UPLOAD-005 分步上传与批量上传
每个文件 SHALL 分三步上传：建立上传、传送内容、完成校验。只有完成校验的文件才成为可识别的原件。一次 SHALL 可以选择最多 10 个文件，逐个上传；单个文件失败 SHALL NOT 影响其他文件。建立上传后 24 小时内未完成的上传 SHALL 失效，其内容 SHALL 被清除。

#### Scenario: AC-FR-UPLOAD-005-01 一个失败不影响其他
- **GIVEN** 用户一次选择 3 个文件，其中第 2 个格式不支持
- **WHEN** 上传
- **THEN** 第 1、3 个文件进入待处理；第 2 个显示失败原因，不留下任何待处理记录

#### Scenario: AC-FR-UPLOAD-005-02 未完成的上传
- **GIVEN** 一个已建立但未完成校验的上传
- **WHEN** 查看待处理列表，或用它建立识别任务
- **THEN** 不在待处理列表中，建立识别任务被拒绝

### Requirement: FR-UPLOAD-010 上传状态
上传 SHALL 依次处于"上传中""已上传""可识别"之一，或"已拒绝"（附原因）。每一步 SHALL 只能从上一步推进，重复提交同一步 SHALL 返回当前状态而不重复处理。

#### Scenario: AC-FR-UPLOAD-010-01 重复完成
- **GIVEN** 一个已完成校验、状态为"可识别"的上传
- **WHEN** 客户端再次提交"完成校验"
- **THEN** 返回"可识别"，不产生第二份原件

### Requirement: FR-UPLOAD-011 原件保留与读取
原件 SHALL 保存在私有对象存储（GCS）中，SHALL NOT 生成匿名或公开的访问地址。读取原件与页预览 SHALL 由后端转发，并按当前用户对该文件的访问权限检查（规则同其所属的识别任务，FR-OCR-017）；无权访问或不存在时 SHALL 返回 404。PDF 的页预览 SHALL 由后端渲染为图片，图片文件的预览即原图。原件 SHALL 在识别任务及其结果被删除前一直保留。

#### Scenario: AC-FR-UPLOAD-011-01 他人无法读取
- **GIVEN** 用户 U 在个人租户上传的原件 F
- **WHEN** 另一用户 V 读取 F 或其页预览
- **THEN** 返回 404

#### Scenario: AC-FR-UPLOAD-011-02 PDF 页预览
- **GIVEN** U 上传的 3 页 PDF
- **WHEN** U 请求第 2 页的预览
- **THEN** 返回该页渲染出的图片；请求第 4 页返回 404

### Requirement: FR-UPLOAD-013 待处理记录
已完成校验、尚未建立识别任务的原件 SHALL 作为"待处理记录"，按当前租户列给上传者本人，按上传时间从新到旧。上传者 SHALL 可以删除自己的待处理记录；已经建立过识别任务的原件 SHALL NOT 能通过此方式删除。删除与建立识别任务 SHALL 互斥：二者同时发生时只有一个成功。

#### Scenario: AC-FR-UPLOAD-013-01 列出与删除
- **GIVEN** U 在组织 O 中上传了 2 个文件，尚未开始识别
- **WHEN** U 以 O 为当前租户查看待处理并删除其中 1 个
- **THEN** 列表先显示 2 条，删除后剩 1 条；以个人租户查看时不显示这 2 条

#### Scenario: AC-FR-UPLOAD-013-02 已建任务的原件不能删除
- **GIVEN** 原件 F 已建立识别任务
- **WHEN** U 删除 F 的待处理记录
- **THEN** 被拒绝，F 与任务都不变

### Requirement: FR-UPLOAD-006 矫正与裁剪
系统 SHALL 在调用 OCR 引擎时开启引擎自带的方向矫正与切边（负责人 2026-11-06，D4），SHALL NOT 修改保存的原件。去阴影与降噪（FR-UPLOAD-007、008，P1）不在本能力内。

#### Scenario: AC-FR-UPLOAD-006-01 请求引擎矫正
- **GIVEN** 一张旋转了 90 度的单据照片
- **WHEN** 系统调用 TextIn 识别
- **THEN** 请求开启方向矫正与切边；保存的原件仍是用户上传的原始文件

### Requirement: FR-UPLOAD-014 按链接导入
用户 SHALL 可以输入一个文件网址，由系统下载后作为原件导入当前租户。导入的文件 SHALL 与上传的文件使用相同的规则（FR-UPLOAD-003）：
- 按内容判断格式；
- 不超过 20 MB，PDF 不超过 50 页。

通过后的文件 SHALL 进入本人的待处理，SHALL NOT 自动开始识别。

为防止借导入访问内部服务，系统 SHALL：
- 只接受 `http` 与 `https` 网址；
- 拒绝解析到内网、本机、链路本地或其他非公网地址的网址；
- 跟随重定向时，SHALL 对每一个新地址重新做同样的检查，重定向最多 3 次；
- 下载超过 20 MB 或 20 秒时 SHALL 中止。

被拒绝或下载失败时，SHALL 指出原因（网址无效、无法下载、地址不允许、格式不支持、过大、页数过多），SHALL NOT 保存任何内容。没有"上传与识别"权限的成员 SHALL NOT 能导入。文件名 SHALL 取自网址路径的最后一段，去掉不安全的字符；没有可用的名称时，SHALL 使用 `import.<格式>`。

#### Scenario: AC-FR-UPLOAD-014-01 导入公开文件
- **GIVEN** 已登录用户，一个公网可访问的 PDF 网址 `https://example.com/inv.pdf`（2 页）
- **WHEN** 用户在首页选择"按链接导入"并提交该网址
- **THEN** 文件 `inv.pdf` 出现在待处理中，记为 2 页，尚未开始识别

#### Scenario: AC-FR-UPLOAD-014-02 拒绝内部地址
- **GIVEN** 网址 `http://127.0.0.1/a.pdf`；另一个公网网址，它重定向到 `http://169.254.169.254/`
- **WHEN** 用户分别导入
- **THEN** 两次都被拒绝，原因为"地址不允许"；不保存任何内容，也不访问重定向后的地址

#### Scenario: AC-FR-UPLOAD-014-03 下载失败或文件不符
- **GIVEN** 一个返回 404 的网址；一个内容为 HTML 网页的网址；一个超过 20 MB 的文件网址
- **WHEN** 用户分别导入
- **THEN** 分别显示"无法下载""格式不支持""文件过大"，不留下待处理记录

#### Scenario: AC-FR-UPLOAD-014-04 无权限
- **GIVEN** 组织成员的角色不含"上传与识别"
- **WHEN** 该成员提交导入
- **THEN** 返回 403，不下载
