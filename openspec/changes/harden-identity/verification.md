# harden-identity 验证记录

## 1. 自动化测试

- 后端：`cd services/api && uv run pytest -q`（本机 Docker PostgreSQL 18，`REQUIRE_INTEGRATION=1`）→ **172 passed**。
- 脚本：`scripts/tests/*.test.sh` 全部通过（compose-config 34、remote-deploy 20 等）；shellcheck、actionlint 通过；接口契约重新生成后无差异。
- CI：提交 `2ccbff2` 的 CI 全部通过。stack 任务按现有服务器的状态模拟升级：先以应用账号迁移到 0002，然后执行 `db-roles.sh` 并确认应用账号仍可读表，最后用迁移账号执行到 head、健康检查、备份恢复演练。

## 2. 验收标准 → 测试

### 本 change 新增

| AC | 测试 | 结果 |
|---|---|---|
| AC-FR-SYS-001-09 再次登录撤销旧会话 | `integration/test_hardening.py::test_relogin_revokes_carried_session` | 通过 |
| AC-FR-SYS-001-10 失效的会话退出 | `test_hardening.py::test_logout_with_dead_session_succeeds` | 通过；服务器上无 Cookie 退出 204 |
| AC-FR-SYS-010-07 游客会话建立频率 | `unit/test_rate_limit.py`（4 条）、`test_hardening.py::test_guest_limit_per_ip`、`test_guest_with_session_not_counted` | 通过；服务器实测见第 3 节 |
| AC-FR-SYS-020-09 邮箱被拒收 | `unit/test_smtp_sender.py::test_recipient_refused_5xx_is_rejected_once`、`test_auth_failure_is_not_rejected`、`test_recipient_refused_4xx_is_not_rejected`、`test_hardening.py::test_email_rejected_400_and_can_resend` | 通过 |
| AC-FR-SYS-019-08 用户名不区分大小写 | `test_hardening.py::test_admin_username_case_insensitive`、`test_admin_commands_accept_any_case`、`test_admin_blank_username_rejected`、`integration/test_db_roles.py::test_admin_username_check_constraint` | 通过 |
| AC-FR-SYS-003-06 应用账号不能解除日志保护 | `test_db_roles.py::test_app_role_cannot_disable_audit_protection`（停用、删除触发器，清空、删除表，删除、修改记录）、`test_app_role_can_use_identity_tables` | 通过；服务器表所有者为 `saiflow_v3_migrator` |

### 被修改需求中原有的 34 条

FR-SYS-001、010、020、019、003 原有的 AC，测试与 `archive/2026-11-03-rebuild-identity/verification.md` 第 2 节所列相同，在本次 172 条中全部通过。

### 缺陷修复（不改 AC）

| 内容 | 测试 | 结果 |
|---|---|---|
| 非字符串值返回 400（AC-FR-SYS-014-03、015-03） | `test_hardening.py` 中 6 条（`test_non_string_profile_field_is_400` 等） | 通过；服务器上 `{"id_token":42}` → 400 |
| 资料没有改动时不写日志 | `test_hardening.py::test_noop_profile_update_not_audited` | 通过 |
| 补索引 | `test_db_roles.py::test_indexes_exist` | 通过 |
| 命令行口令不回显 | `unit/test_cli_admin.py`（终端与管道两种方式） | 通过 |

## 3. 部署后的服务器检查（2026-11-04）

负责人在 `/opt/saiflow/.env` 中加入 `DB_MIGRATE_PASSWORD` 后，部署 `2ccbff2`（Deploy run 41809170405，成功）。

| 检查 | 结果 |
|---|---|
| 从开发机连续 31 次 `POST /api/v1/auth/guest` | 30 次 200，第 31 次 429 `guest_too_many` |
| 从服务器公网 IP 连续 31 次；随后由 Caddy 容器直接访问后端 | 30 次 200 + 1 次 429；随后直接访问为 200，说明额度按来源 IP 分别计算 |
| 无 Cookie `POST /api/v1/auth/logout` | 204 |
| `audit-verify` | `audit log OK (70 entries)` |
| `saiflow_v3` 中表的所有者 | 只有 `saiflow_v3_migrator` |
| 当场备份后的 `restore-check.sh` | `restore-check OK` |

## 4. 最终审查

由独立审查员检查整个分支：0 Critical，1 Important，9 Minor。

**已修复的 Important 问题：** 转移所有权与授权之间的空档。修复前在本机重现：先迁移到 0002，执行角色步骤后，应用账号读表报 `permission denied for schema saiflow_v3`。修复后同一步骤可以正常读表，CI 也会重放这一步。

**暂不处理的 Minor 问题（负责人决定是否另开 change）：**
- 限频每次请求都会扫描全部 IP 记录；IPv6 按单个地址计算。
- 中继或策略类的 5xx 拒绝（如 554 5.7.1）会被报成 `email_rejected`。
- 收件阶段的 4xx 错误不重试（本 change 之前就存在）。
- `postgres-init/01-app-user.sh` 的注释与 CREATE 授权已过时（实际已被 `db-roles.sql` 收回）。
- `.env` 中带引号的 `DB_MIGRATE_PASSWORD` 会导致迁移登录失败（会在重启前失败，不影响运行中的版本）。
- 接口集成测试仍以超级账号运行；`app_role_db` 假定本机应用账号的口令是 `local-app`。
- 0003 回退后应用账号没有任何权限，回滚说明需要补充。
- Python 与 SQL 对制表符和非 ASCII 字符的规范化不一致。
- 应用账号仍有 `alembic_version` 的 INSERT 权限。

## 5. 未覆盖

- IPv6 访问者的限频：当前域名没有 AAAA 记录，未实测。
- 前端如何展示 `guest_too_many` 与 `email_rejected`：留给 B-5。
