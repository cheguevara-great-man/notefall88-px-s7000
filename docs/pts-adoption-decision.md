# Piano Trainer Studio 采用决策

> 状态：已接受  
> 日期：2026-08-05  
> 适用范围：NoteFall 88 网页、固件通信协议、乐谱与练习引擎  
> 审计对象：Piano Trainer Studio [`9b21d7e`](https://github.com/ztbishop/piano-trainer-studio/tree/9b21d7e7277aa1da8d82b3d67fe036bfccd11e81)（v1.2.4，AGPL-3.0）

## 决策

Piano Trainer Studio（PTS）提升为 NoteFall 88 的**第一软件/产品参考**，但本仓库不 fork、不复制 PTS 的源码或网页资源。NoteFall 88 继续采用 MIT，按公开功能和可观察行为独立实现；第三方库单独评估并保留各自许可证。

如果未来决定直接修改 PTS，修改版将进入独立的 AGPL 仓库/发行物，不与当前 MIT 核心混为一个仅标 MIT 的产品。此处是工程许可证边界记录，不替代正式法律意见。

## 为什么必须先做这个决策

PTS 与目标功能高度重合：MusicXML/MXL 谱面、Realtime、Wait for Me、Follow Me、左右手、循环、变速、移调、得分、IndexedDB 曲库/备份和逐键 LED 校准都已经存在。忽略它会重复探索产品行为；直接搬用它又会改变许可证、运行位置和硬件链路。因此在继续曲库、MusicXML 和 Follow Me 之前，必须明确哪些是产品需求，哪些是可复用依赖，哪些不能复制。

## 已审计的 PTS 架构

PTS 的核心计算在浏览器，不在 WLED：

```mermaid
flowchart LR
    SCORE["MusicXML / MXL<br/>MIDI 等先转换"] --> TARGET["浏览器<br/>谱面解析与目标音符"]
    PIANO["钢琴 USB / 蓝牙 MIDI"] -->|"Web MIDI<br/>iOS 需 MIDIWeb"| ACTUAL["浏览器<br/>实际演奏音符"]
    TARGET --> MATCH["练习状态机<br/>命中、等待、跟随、得分"]
    ACTUAL --> MATCH
    MATCH --> UI["谱面与反馈"]
    MATCH --> PIXEL["浏览器 RGB 帧缓冲"]
    PIXEL -->|"HTTP JSON"| WLED["WLED ESP32"]
    PIXEL -->|"localhost helper → DDP/UDP"| WLED
    PIXEL -.可选 MIDI 输出.-> MIDI_LED["MIDI LED 设备"]
```

必须区分两路数据：

1. **参考/目标音符**来自浏览器加载的 MusicXML/MXL，或由 MIDI、MuseScore、Guitar Pro 转换后的 MusicXML。
2. **实际演奏音符**来自钢琴 MIDI 输入。

浏览器比较两路数据。WLED 通常只收最终 RGB 像素帧，不解析乐谱，也不知道左右手和命中规则。PTS 的低延迟 DDP 不是浏览器直接发送 UDP，而是把完整帧 POST 给本机 Node helper，再由 helper 发到 WLED 的 UDP 4048 端口；无 helper 时回退 HTTP JSON。

## NoteFall 的目标拓扑

```mermaid
flowchart LR
    SCORE["MIDI / MusicXML / MXL"] --> B["手机 / 平板 / 电脑浏览器<br/>参考音符、谱面、练习状态"]
    P["PX-S7000"] -->|"USB-MIDI"| E["ESP32-S3<br/>实际演奏事件 + 灯光实时层"]
    E -->|"SPI"| LED["APA102 / SK9822 单排灯带"]
    E -->|"WebSocket：实际演奏音符"| B
    B -->|"WebSocket：语义目标音符"| E
```

与 PTS 相比，NoteFall 把钢琴 MIDI Host 和灯带驱动放在同一台 ESP32-S3：

- 按下琴键后的即时亮灯不经过 Wi-Fi；
- iPhone/iPad/Android 页面不需要 Web MIDI，也不需要 MIDIWeb；
- 浏览器发送的是“哪些 MIDI 音符是目标、显示何种角色”的语义消息，而不是持续发送 176 个 RGB 像素；
- ESP32 掌握真实灯位映射、亮度/电流上限、超时熄灯和安全状态；
- 浏览器仍掌握乐谱、时间线、循环、左右手、判分和曲库。

这条边界允许界面暂时掉线时仍保留本地按键反馈，也不会让 Wi-Fi 抖动进入最短实时路径。

## 两种路线比较

| 维度 | 直接 fork PTS 网页（AGPL） | NoteFall 独立实现（MIT，已选） |
|---|---|---|
| 首批成熟功能 | MusicXML、三模式、谱面、曲库和校准可较快获得 | 需要逐项实现；MIDI 实时/等待、循环、左右手和得分已有基线 |
| 许可证 | 衍生前端必须遵守 AGPL；网络交互版本须显著提供相应源码 | 自写核心保持 MIT；每个第三方依赖按自己的许可证归档 |
| 与现有硬件的匹配 | 默认 Web MIDI → 浏览器 → WLED；需重写输入、灯光和连接状态 | 原生就是 PX-S7000 → ESP32 → APA102/SK9822 |
| iOS/Android | iOS MIDI 需 MIDIWeb，WLED 场景还可能需 PC/Mac helper | 移动浏览器只连 ESP WebSocket，不需要 Web MIDI/helper |
| 实时灯光 | 浏览器生成 RGB 帧并经网络发往 WLED | ESP 直接处理实际按键；目标音符才经 Wi-Fi 提前下发 |
| 固件容量 | PTS 快照含约 24.2 MB webmscore、1.2 MB OSMD，无法原样进入 2.875 MB LittleFS | 只加入需要的库；OSMD 可评估嵌入，重型转换器放到可选电脑端 |
| 工程结构 | Plain JS + 多个全局模块；核心/LED 大文件，适配会是侵入式改造 | TypeScript 模块、协议版本、单元测试和固件 CI 已建立 |
| 长期维护 | 能获得上游修复，但每次合并都要处理自定义硬件分叉 | 需要自己实现功能，但边界更小、设备行为更确定 |
| 最终用户步骤 | 可能需要浏览器 MIDI 权限、MIDIWeb 或 helper | 预期只需钢琴接 ESP、手机连设备 Wi-Fi 并打开页面 |

结论不是“AGPL 不好”，而是 PTS 的许可证和默认拓扑都对应另一种产品。即使接受 AGPL，仍需大规模改写 MIDI 输入、WLED 帧输出、设备诊断和移动端路径；fork 并不能直接变成 NoteFall 成品。

## 资源容量结论

当前 ESP32-S3 N8R8 分区为双 OTA 应用各 `0x280000`，LittleFS 为 `0x2E0000`（2.875 MiB）。PTS 固定快照中：

| 资源 | 审计大小 | NoteFall 处理 |
|---|---:|---|
| OSMD 压缩脚本 | 1,206,484 bytes | 可单独评估并嵌入；需做实际 buildfs 和移动端性能测试 |
| Tone.js | 349,169 bytes | 不需要；PX-S7000 自己发声 |
| webmscore 目录 | 24,173,611 bytes | 不嵌入固件；后续可做可选电脑端转换包 |
| PTS 自写 JS/CSS/HTML/helper | 约 15,720 非空行 | 只研究功能与边界，不复制 |

因此首个 MusicXML 版本采用“MusicXML/XML/MXL 原生导入 + MIDI 原生导入”。MuseScore/Guitar Pro 用户可先导出 MusicXML；浏览器内重型转换列为可选桌面扩展，而不是阻塞钢琴前的手机体验。

## 分功能采用计划

| PTS 已验证的能力 | NoteFall 做法 | 采用边界 |
|---|---|---|
| MusicXML/MXL + 谱面 | 独立集成 OSMD（BSD-3-Clause），建立自己的谱面适配层 | 不复制 PTS 的 OSMD 包装和 trainer-core |
| MIDI/MuseScore/Guitar Pro 转换 | MIDI 保留 `@tonejs/midi`；重型格式转换后置到可选桌面包 | 不把 24 MB webmscore 塞入 ESP |
| Realtime / Wait / Follow | 在现有 TypeScript 练习引擎上补 Follow Me 和踏板语义 | 用测试定义行为，不复制状态机代码 |
| 左右手/循环/变速/移调/得分 | 延续统一时间线和声部过滤；加入版本化练习配置 | 目标灯与判分消费同一过滤结果 |
| IndexedDB 曲库/备份 | 独立设计版本化 schema、文件夹、最近使用和可校验备份 | 借鉴产品需求，不复制对象结构或 UI 代码 |
| LED 逐键校准 | 先用真实琴键几何 + 原点/方向/全局偏移；实测不足时再加逐键微调 | 灯位真相在 ESP；浏览器只操作语义参数 |
| WLED HTTP/DDP | 不作为主链路 | ESP 直接 SPI 驱动 APA102/SK9822，无 helper |
| Web MIDI/MIDIWeb | 不作为 PX-S7000 主链路；未来可作为无硬件演示输入 | 手机只消费 ESP 标准化事件 |

## 独立实现的可审计规则

- 本仓库不导入 PTS 文件、代码片段、CSS、图片、曲库或构建产物。
- 新功能先写 NoteFall 行为规格与测试，再在现有 TypeScript/C++ 模块中实现。
- 可复用第三方依赖从其官方发行渠道单独引入，固定版本，保存许可证和 NOTICE，而不是从 PTS 的 vendored 副本复制。
- 提交说明标明“受哪项公开产品行为启发”与“实际独立实现文件”，便于后续审计。
- 若需要制作 PTS 兼容桥或直接给 PTS 增加 NoteFall 输出端，单独建 AGPL 项目并保留显著源码入口。

因为当前工程人员已经阅读过 PTS 源码，本方案不宣称是由隔离团队执行的 formal clean-room 工程；准确说法是“源码可审计后的独立实现，并禁止复制”。

## 继续开发的顺序

1. 完成延音踏板（CC64）、All Notes Off 和演奏事件录制基础，保证实际演奏流完整。
2. 实现独立的 IndexedDB 曲库、版本化备份与恢复，并为失败/迁移写测试。
3. 引入官方 OSMD 包并做 MusicXML/MXL 解析与谱面渲染适配；先用真实钢琴曲测试移动端内存和首屏时间。
4. 把 MusicXML 音符、谱表和声部标准化到现有时间线，确保谱面、目标灯和判分共享同一数据源。
5. 补 Follow Me、移调和逐键微调，再做手机/平板实机验收。
6. 最后评估可选电脑端 webmscore 转换器；它不能成为钢琴前日常练习的必需步骤。

## 参考资料

- [Piano Trainer Studio 官方仓库](https://github.com/ztbishop/piano-trainer-studio)
- [Piano Trainer Studio 官方使用说明](https://pianotrainerstudio.com/README.html)
- [PTS 固定审计提交](https://github.com/ztbishop/piano-trainer-studio/tree/9b21d7e7277aa1da8d82b3d67fe036bfccd11e81)
- [GNU AGPL-3.0 正文](https://www.gnu.org/licenses/agpl-3.0.en.html)
- [GNU GPL FAQ：AGPL 网络交互](https://www.gnu.org/licenses/gpl-faq.en.html#AGPLv3InteractingRemotely)
- [OpenSheetMusicDisplay 官方仓库（BSD-3-Clause）](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay)

