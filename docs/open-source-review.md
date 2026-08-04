# 外部开源代码审查

本项目不沿用仓库上一版的任何实现。新架构从以下外部项目和官方接口重新设计。

| 项目 | 许可证 | 采用内容 | 不采用内容 |
|---|---|---|---|
| [ESP32_Host_MIDI](https://github.com/sauloverissimo/ESP32_Host_MIDI) | MIT | 基于 v7.2.0 的 Host/Client/队列结构实现项目专用 `UsbMidiHost`，保留 USB-MIDI 枚举、端点读取和断线恢复 | 多传输路由、BLE、RTP-MIDI、MIDI 2.0、显示屏例程 |
| [Piano-LED-Visualizer](https://github.com/onlaj/Piano-LED-Visualizer) | MIT | 参考“灯带方向、琴键范围和可保存校准必须由用户设置”的产品经验 | Raspberry Pi、WS281x 驱动、旧网页和单机安装体系 |
| [PianoLux ESP32](https://github.com/serifpersia/pianolux-esp32) | MIT | 交叉验证 ESP32-S3 可同时运行 USB Host、Wi-Fi 网页和单排钢琴灯带 | 线性 MIDI→LED 映射、WS2812 专用效果、大量运行时功能开关 |
| [Piano Trainer Studio](https://pianotrainerstudio.com/) | 可用产品参考 | 参考等待练习、左右手颜色、LED 校准和浏览器曲库交互 | 不复制其未在仓库中明确授权的当前网页代码 |
| [Openthesia](https://github.com/ImAxel0/Openthesia) | GPL-3.0 | 只研究瀑布流、循环和速度控制的交互，不复制代码 | GPL 桌面渲染器和音频引擎 |
| [@tonejs/midi](https://github.com/Tonejs/Midi) | MIT | 网页端标准 MIDI 文件解析和速度/节拍换算 | Web Audio 合成；声音仍由 PX-S7000 发出 |

固件通过 `platformio.ini` 锁定上游版本，网页通过 `package-lock.json` 锁定 NPM 依赖。仓库只包含针对 NoteFall 88 新写的业务代码；第三方库不复制进源代码目录。

## 选择原因

`ESP32_Host_MIDI` 解决了本项目风险最高的 USB 类驱动思路。正式固件只保留约 250 行项目专用 USB-MIDI 1.0 Host，避免上游整库把 BLE/RTP 等未使用源文件也编进固件。可复现构建基线是 Arduino-ESP32 2.0.17；源码另外保留了新版枚举过滤字段的条件编译入口，但仍需在升级核心时重新做 PX-S7000 实机枚举回归。`@tonejs/midi` 把 MIDI tempo map 转换为秒时间轴，避免自行重写易错的变速解析。其余项目主要提供产品经验，而不是代码依赖。
