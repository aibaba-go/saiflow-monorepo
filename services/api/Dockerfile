# Flask 用户服务镜像
FROM python:3.12-slim

# 设置时区，避免日志时间错乱
ENV TZ=Asia/Shanghai

# FR-SYS-001/014/016：生产仅使用 LINE 认证，禁用开发身份与邮箱校验绕过。
ENV APP_ENV=production
ENV AUTH_DEV_MODE=false

# 工作目录
WORKDIR /app

# 先装依赖（利用 Docker 层缓存：代码变动不会重新装包）
# 默认走官方 PyPI（Google Cloud Build 访问不了腾讯云/清华镜像）；国内本地构建可加 --build-arg PIP_INDEX_URL=https://mirrors.cloud.tencent.com/pypi/simple
ARG PIP_INDEX_URL=https://pypi.org/simple
COPY requirements.txt .
RUN pip install --no-cache-dir \
    --index-url ${PIP_INDEX_URL} \
    --timeout 120 --retries 5 \
    -r requirements.txt

# 复制应用代码（模块白名单；email_sender.py 为 FR-SYS-014/016 TLS 验证码发送）
COPY app.py config.py extensions.py models.py auth.py errors.py fileaccess.py middleware.py worker.py workspace.py storage.py quota.py plans.py deepseek.py avatars.py email_sender.py subscriptions.py reminders.py mapping_worker.py manage_templates.py manage_plans.py ./
# FR-SYS-019：套餐配置种子（plans 表为空时导入，也是数据库不可用时的内置兜底目录）
COPY plans_seed.json ./
COPY routes ./routes
# FR-OCR-018..021 / FR-TEMPLATE-001..006：模板映射模块、后台维护脚本与已审批系统模板种子
COPY doc_templates ./doc_templates
COPY templates_seed ./templates_seed
# TextIn OCR provider（唯一厂商，PRD §12）
COPY textin ./textin

# 暴露端口（Cloud Run 注入 PORT=8080，探活按 $PORT 检查）
EXPOSE 8080

# 持久化目录（运行时挂载 volume）
#   /app/temp     — TextIn OCR 抽取记录 + 原始上传文件
RUN mkdir -p /app/temp/extractions /app/temp/uploads
VOLUME ["/app/temp"]

# 用 gunicorn 生产级 WSGI 启动，监听 Cloud Run 注入的 $PORT
# --workers 1：每个进程各起一个 OCR worker 线程并各自跑启动 DDL；认领虽是原子条件更新，
#   多进程仍会成倍增加轮询与启动争锁，横向扩容交给 Cloud Run 多实例。
# --threads 12：gthread 模式，同一进程内并发处理请求（NFR-PERF-005）。
#   必须与 Cloud Run `--concurrency 12` 相等：并发大于线程数时多出的请求只会在进程内排队，
#   而不会触发扩容；同时须 ≤ config.py 的连接池上限（pool_size + max_overflow）减去 OCR worker 的 1 个连接。
CMD exec gunicorn --workers 1 --threads 12 --timeout 300 \
    --bind "0.0.0.0:${PORT}" \
    --access-logfile - --error-logfile - \
    app:app
