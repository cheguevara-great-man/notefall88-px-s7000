# ADR-005: Studio 离线 MuseScore / Guitar Pro 转换层

- 状态：已接受并实现
- 日期：2026-08-11
- 范围：NoteFall Studio PWA、Android/iOS 安装包、Core 容量与许可证边界

## 决策

Studio 固定使用 `webmscore-webpack5` 0.21.0-a，在本地 Web Worker 中把
MuseScore（MSCZ/MSCX）、Guitar Pro（GP/GP3/GP4/GP5/GPX/GTP/PTB）和 KAR
转为 MusicXML，再交给 NoteFall 自己的安全 MusicXML 解析、统一时间线、
OSMD 与练习引擎。转换后的 MusicXML 而非原生大文件进入 IndexedDB，
因此二次打开不再启动 WASM。

Core 不包含转换器。用户在 Core 误选高级格式时会得到明确的
Studio 提示，不会尝试网络下载或让 ESP32 解析。

## 为什么不使用 CDN

上游 npm 包的默认 `browser` 入口指向 jsDelivr，会在首次转换时下载
WASM/data 资源。这与断网可练习和可重复发行冲突。构建前的
`web/scripts/sync-studio-vendor.mjs` 只从锁定 npm 包复制下列四个文件：

- `webmscore.mjs`；
- `webmscore.lib.data`；
- `webmscore.lib.mem.wasm`；
- `webmscore.lib.wasm`。

运行时 URL 固定在 `./vendor/webmscore-0.21.0-a/`。Studio Service Worker 把它们
纳入版本化全资源预缓存；Capacitor 将同样的文件打入 APK/App。

## 运行与安全边界

- 原文件和转换后 XML 均限制为 64 MB。
- 结果必须含 `score-partwise` 或 `score-timewise` 根，否则拒绝。
- 采用完整 layout 加载；上游 boost mode 只适用元数据/MIDI，用它导出
  MusicXML 会丢失 staff 模型。
- 每次转换拥有独立 Worker，成功或失败都终止 Worker，批量导入串行执行，
  不在平板上同时复制多份约 20 MB 运行时。
- 自动化使用本仓库自己创建的 MSCX 乐谱，真实转换为 3 个目标音、
  渲染五线谱，并拒绝公网 CDN 入口。
- `npm run verify:studio` 校验四个运行时文件的逐文件大小与 SHA-256、GPL/
  第三方声明、Service Worker 全量预缓存、64 MiB 发行预算，并防止 GPL 运行时
  误入 MIT Core；该检查进入 GitHub CI。

## 容量结论

Studio 的非压缩构建约 24.9 MB，其中转换运行时约 19.9 MB。它在小米
Pad 7 Ultra / 手机 / 电脑上运行，不是 ESP32 固件资源。Core 仍在
500 KiB 压缩资源门禁内。

## 许可证

`webmscore-webpack5` 声明 GPL，因此包含该运行时的 Studio PWA 和 App 作为
组合发行物按 GPL-3.0 传递；完整许可证在 `studio/public/legal/GPL-3.0.txt`。
NoteFall 原创源码仍可按 MIT 单独使用。未链接、未分发该运行时的 Core 仍为 MIT。

固定完整性：

`sha512-AI1e+knofehVOwQT9FJHhuNQcOvpz+EfzzfC+U2ANTrj2KgC9kZe6/Ukmm/xCL/ojyBoC0hSb8iq3ZqVJgRYRg==`

上游源码：<https://github.com/LibreScore/webmscore>
