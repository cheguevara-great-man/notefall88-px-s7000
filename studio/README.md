# NoteFall Studio

NoteFall Studio 是独立于 ESP32 LittleFS 的手机、平板和电脑端发行物。它与 NoteFall Core 共享经过测试的 MusicXML/MIDI、练习、曲库、分析和 WebSocket 协议源码，但拥有独立构建、PWA 清单、离线缓存、Core 地址设置和面向横屏平板的五线谱/瀑布流双视图。Studio 另外内置 Worker 隔离的离线 MuseScore、Guitar Pro 和 KAR 转换；首次导入转为 MusicXML 后存入曲库，后续打开不再加载转换引擎。

```powershell
cd web
npm.cmd ci
npm.cmd run build:studio
npm.cmd run verify:studio
npm.cmd run dev:studio
```

构建输出位于 `dist/studio/`，不会写入 ESP32 的 `firmware/data/`。首次完整打开后，同源静态资源由 Service Worker 缓存；乐谱与练习历史继续保存在当前设备 IndexedDB。

浏览器安全边界仍然真实存在：从公网 HTTPS 页面访问 ESP 的 `ws://` 连接可能被混合内容或本地网络权限阻止。正式移动端因此使用同一 Web 代码加 Capacitor 原生容器；Android/iOS 平台工程已进入 `studio/android` 与 `studio/ios`。Core 自带网页始终保留为无需安装的恢复入口。

## 两种发行物，不是两套产品

- **Android/iOS App**：练琴平板的主力入口，资源随安装包离线提供，原生层负责局域网权限与生命周期。
- **PWA**：电脑、临时设备和开发调试的备用入口。

二者共享 `web/src` 的界面、乐谱、练习和协议实现。用户无需同时安装；正式装配说明将把 Android/iOS App 列为推荐项，把 PWA 列为备用项。

## 构建与同步

```powershell
cd web
npm ci
npm run build:studio
npm run verify:studio
cd ..\studio
npm ci
npm run sync
```

Android 使用 JDK 21 与 Android SDK 36，可用 `android/gradlew.bat assembleDebug` 构建；它已注册 `NativeWaterfall` 插件，使用硬件加速 Android View 绘制瀑布流。iOS 工程必须在 macOS/Xcode 上签名构建，目前使用 Canvas/WebGL 回退。生成的 App 只加载随包资源，不加载远程站点。架构理由和性能门禁见 `docs/decisions/004-studio-hybrid-native.md`。

## 许可证

Core 固件和内置网页仍按 MIT 发行。Studio 安装包/PWA 因随包分发 GPL
`webmscore-webpack5` 转换运行时，组合发行物按 GPL-3.0 传递。详细边界见
[`LICENSE.md`](LICENSE.md) 和 `docs/decisions/005-studio-score-converter.md`；完整 GPL
正文会作为 `legal/GPL-3.0.txt` 随 PWA 和 App 离线分发。
