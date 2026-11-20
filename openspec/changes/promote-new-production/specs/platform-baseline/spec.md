## MODIFIED Requirements

### Requirement: FR-PLAT-005 手动触发部署
部署 SHALL 只能由人手动触发，推送代码或合并 PR SHALL NOT 自动部署。部署 SHALL 只接受 CI 已通过的提交。手动部署 SHALL 明确选择 production 或 test，未选择时 SHALL 默认 test；每个目标 SHALL 使用自己的服务器、域名与 CI Environment 凭据，镜像标签 SHALL 区分目标，避免不同 LINE 构建配置覆盖同一标签。仓库内容 SHALL NOT 包含私钥、服务账号密钥或其他凭据；部署所需的凭据 SHALL 只保存在 CI 平台的加密 Secrets 中；服务器上 SHALL NOT 长期保存镜像仓库凭据。系统数据库 SHALL NOT 可从公网访问。部署 SHALL 在后端健康检查（含数据库连通性）以及三个前端地址的健康检查都返回正常后才报告成功，否则报告失败。

#### Scenario: AC-FR-PLAT-005-01 推送不触发部署
- **WHEN** 向 `chore/ai-workflow-v2` 推送提交
- **THEN** CI 运行，但不发生任何部署

#### Scenario: AC-FR-PLAT-005-02 拒绝未通过 CI 的提交
- **GIVEN** 某提交的 CI 未通过或尚未完成
- **WHEN** 有人手动触发部署该提交
- **THEN** 部署被拒绝，不构建、不发布任何服务

#### Scenario: AC-FR-PLAT-005-03 部署后健康检查失败
- **GIVEN** 新版本已在服务器上启动，但后端无法连接系统数据库
- **WHEN** 部署流程执行发布后的健康检查
- **THEN** 部署报告失败，并给出健康检查的结果

#### Scenario: AC-FR-PLAT-005-04 仓库中没有凭据
- **WHEN** 检查仓库内容与 CI 配置
- **THEN** 不存在私钥、服务账号密钥或其内容；部署用的 SSH 私钥只出现在 CI 平台的加密 Secrets 中

#### Scenario: AC-FR-PLAT-005-05 镜像仓库凭据不留在服务器上
- **GIVEN** 一次部署已结束（成功或失败）
- **WHEN** 检查服务器上部署账号的 Docker 登录凭据
- **THEN** 其中没有镜像仓库的凭据

#### Scenario: AC-FR-PLAT-005-06 数据库不对公网开放
- **GIVEN** 服务已部署
- **WHEN** 从服务器以外的网络尝试连接服务器的数据库端口
- **THEN** 连接失败

#### Scenario: AC-FR-PLAT-005-07 目标隔离
- **WHEN** 人手动选择 test 或 production 部署
- **THEN** 工作流只使用所选 Environment 的目标服务器和凭据，不更新另一环境；同一提交不同目标的镜像标签不相同

#### Scenario: AC-FR-PLAT-005-08 安全默认值
- **WHEN** 人触发手动部署但没有改变默认目标
- **THEN** 部署目标为 test，不触碰生产
