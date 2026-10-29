import os
import firebase_admin
from firebase_admin import credentials
from firebase_admin import storage

# 0. 让 gRPC/HTTPS 走本机代理（Firestore/Storage 的 gRPC 通道不读 Windows
#    系统代理，必须显式设置环境变量；已在别处设置过则不覆盖，部署到 GCP 时可删除）
# if not os.getenv("HTTPS_PROXY"):
#     os.environ["HTTP_PROXY"] = "http://127.0.0.1:7890"
#     os.environ["HTTPS_PROXY"] = "http://127.0.0.1:7890"

# 1. 显式设置当前 Google Cloud 项目 ID 环境变量，
#    确保 SDK 精确指向您的 "saiflow-509205" 项目
os.environ["GOOGLE_CLOUD_PROJECT"] = "saiflow-509205"

# 2. 初始化 SDK。ApplicationDefault() 会自动寻找您本地刚才生成的凭证。
#    必须传入 storageBucket，否则访问 Storage 会报 "Project '' not found"。
cred = credentials.ApplicationDefault()
firebase_admin.initialize_app(cred, {
    "projectId": "saiflow-509205",
    "storageBucket": "saiflow-509205.firebasestorage.app",
})

# 3. 获取存储桶句柄（对应控制台 gs://saiflow-509205.firebasestorage.app）
bucket = storage.bucket()

# 4. 上传文件到存储桶
try:
    blob = bucket.blob("demo/firebase_demo_upload.png")
    blob.upload_from_filename(
        r"c:\Users\F\AppData\Roaming\Trae CN\User\workspaceStorage\085c363f8e4fc71c62bb0c39fdd02088\paste-files\d55fb81d-9f6d-4f9b-9ffa-fc7d3b4b7ef5_image.png",
        content_type="image/png",
    )
    print("【成功】文件已上传至 Cloud Storage！")
    print(f"  对象路径: {blob.name}")
    print(f"  大小    : {blob.size} 字节")

    # 5. 列出桶内前 20 个对象（应包含已有的 Capture001.png）
    print("\n桶内对象列表（前 20 个）:")
    for b in bucket.list_blobs(max_results=20):
        print(f"  {b.name}  ({b.size} 字节, {b.content_type})")

    # 6. 下载回本地
    blob.download_to_filename(r"d:\work\trae-project\demo\downloaded_demo.png")
    print("\n【成功】文件已下载到 d:\\work\\trae-project\\demo\\downloaded_demo.png")
except Exception as e:
    print(f"【出错啦】请检查当前凭证是否拥有该项目的 Storage 权限：\n{e}")
