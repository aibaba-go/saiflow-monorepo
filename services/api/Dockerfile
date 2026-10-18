# Flask 用户服务镜像
FROM python:3.12-slim

# 设置时区，避免日志时间错乱
ENV TZ=Asia/Shanghai

# 临时：LINE 暂不可用，生产与本地一致开启开发调试（dev_id 登录、随机 LINE 资料、邮箱验证码不发信不校验）
# 恢复 LINE 联合登录时改为 false（或 docker run -e AUTH_DEV_MODE=false 覆盖）
ENV AUTH_DEV_MODE=true

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

# 复制应用代码（根目录模块白名单；storage.py 对象存储抽象、quota.py 配额流水、plans.py 套餐目录、avatars.py 头像存储）
COPY app.py config.py extensions.py models.py auth.py errors.py fileaccess.py middleware.py worker.py workspace.py storage.py quota.py plans.py deepseek.py avatars.py ./
COPY routes ./routes
# TextIn OCR provider（唯一厂商，PRD §12）
COPY textin ./textin

# 暴露端口（Cloud Run 注入 PORT=8080，探活按 $PORT 检查）
EXPOSE 8080

# 持久化目录（运行时挂载 volume）
#   /app/temp     — TextIn OCR 抽取记录 + 原始上传文件
RUN mkdir -p /app/temp/extractions /app/temp/uploads
VOLUME ["/app/temp"]

# 用 gunicorn 生产级 WSGI 启动，监听 Cloud Run 注入的 $PORT
# --workers 1：OCR worker 是进程内线程，多进程会起多个消费者重复抢单
# --threads 8：gthread 模式，同一进程内并发处理请求
CMD exec gunicorn --workers 1 --threads 8 --timeout 300 \
    --bind "0.0.0.0:${PORT}" \
    --access-logfile - --error-logfile - \
    app:app
