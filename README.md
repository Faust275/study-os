# 日迹 (Study OS)

独立包名 `com.faust275.studyos`（与旧版 Course Planner 共存互不覆盖），同一仓库同时支持 **GitHub Pages 在线 PWA** 与 **GitHub Actions 云端自动编译安卓 APK**。

## 如何拿到可安装的安卓 APK
1. 将本压缩包解压后的全部文件覆盖提交到你的 `Faust275/study-os` 仓库 `main` 分支。
2. 打开仓库顶部的 **Actions → Build Study OS Android APK**，等待约 3–5 分钟构建完成。
3. 在页面底部 **Artifacts** 下载 `StudyOS-debug-APK`（解压即得 `StudyOS-debug.apk`），发到小米手机直接安装即可。
4. 首次打开后，在 **生活 → 睡眠与健康** 点 **「同步 Health Connect」** 授权，即可直接读取小米运动健康写入系统的睡眠分期与步数。

（可选：若后续希望固定签名以便无卸载覆盖升级，可在仓库 Settings → Secrets 中配置 `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。）
