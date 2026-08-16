# ESP32-S3 固件

固件面向乐鑫官方 `ESP32-S3-DevKitC-1-N8R8`。原生 `USB/OTG` Micro-USB 口作为钢琴 USB Host；另一个 `UART` Micro-USB 口用于烧录和日志。

PlatformIO 构建横幅沿用通用板卡元数据，可能显示 `N8 (No PSRAM)`；本项目环境实际固定 `qio_opi`、OPI PSRAM 和 `BOARD_HAS_PSRAM`，链接映射使用 `esp32s3/qio_opi` SDK。最终仍以开发板启动日志和网页约 8 MiB 的 PSRAM 诊断为实物真相。

## 生成、构建和烧录

```powershell
python scripts/generate.py
cd web
npm.cmd ci
npm.cmd run build
cd ..
.\.venv\Scripts\platformio.exe run -d firmware
.\.venv\Scripts\platformio.exe run -d firmware -t upload
.\.venv\Scripts\platformio.exe run -d firmware -t uploadfs
```

首次必须同时烧录固件和 LittleFS 网页。后续只改网页时可仅执行 `uploadfs`。

## 运行状态

- 热点：`NoteFall-88`
- 密码：`notefall88`
- 网页：`http://192.168.4.1`
- 家庭 Wi-Fi 下：`http://notefall.local`（取决于路由器/客户端 mDNS）
- WebSocket：端口 `81`
- 固件：0.7.2
- 协议：v6

亮度上限 `4/31` 写在生成头文件中。修改网页滑块不能越过该值。

## 实机诊断

网页“灯带校准 → 设备诊断”显示 USB VID/PID、MIDI IN/OUT 端点与包长、双向累计包数、IN/OUT 队列当前深度与峰值、OUT 排程深度、输入队列丢包/CIN 坏包/传输错误、疑似输出镜像、USB 回调到实时任务及 SPI 完成的两段内部延迟、SPI 帧耗时、实时任务心跳/栈余量/看门狗、ESP/浏览器拒绝消息、网页 MIDI 队列峰值/丢弃/重同步、连接次数、空闲堆、PSRAM、NVS、上次复位原因和 Wi-Fi RSSI。合法但不消费的 SysEx、时钟和 Active Sensing 会被忽略而不计为坏包；疑似镜像只计数，绝不吞掉无法与真实弹奏区分的输入。N8R8 启动时会检查 OPI PSRAM；网页应显示约 8 MiB 总量。正常连续弹奏和跟随伴奏时输入侧 `丢包 / 坏包 / 传输错误`、输出侧 `丢包 / 错误`、网页 MIDI 丢弃和两侧拒绝数都应保持 0，并且不得出现 `brownout`、`panic` 或 `watchdog` 复位。

`firmware/include/midi_core.h`、`realtime_core.h` 与 `usb_midi_descriptor.h` 是目标固件实际使用且不依赖 Arduino 的实时核心。`python -m pytest tests/test_firmware_core_native.py` 会以主机 `g++` 的严格警告选项编译并执行 MIDI 包、CC88、计时、真实灯位、固定容量环形队列、饱和延迟统计和 USB MIDIStreaming 描述符选择；这不是另写的模拟器。随后仍必须用 PlatformIO 的 Xtensa 工具链构建完整固件。

USB Host daemon 与 MIDI client 使用两个专用 FreeRTOS 任务，client 最长 5 ms 事件等待不再排在 daemon 的 20 ms 等待之后。IN 回调只打微秒时间戳并写入固定长度环形队列；整个 USB transfer（同批和弦）入队后只唤醒一次优先级更高、固定在 Core 0 的实时任务，既保留单帧和弦又不会被持续输入饿死。实时任务先完成灯带帧，再由 Core 1 的 Arduino 主任务从独立 128 项网页队列限量广播。网络、JSON 和 OTA 不进入实时任务，Wi-Fi 拥塞不会阻塞实体灯；网页队列极端溢出时以既有全通道 CC64/66/67/123 + 当前按键事件重同步，避免漏掉 Note Off 或踏板释放后永久挂键。APA102 的 719 字节帧用单次硬件 SPI 批量操作发送，RGB 顺序、5-bit 全局亮度和 8 MHz 线速不变；状态未改变时不再重复发送原有的 100 fps 空帧。网页只传相对时间事件，固件以 `millis()` 排程；钢琴 USB 断开会立即清空目标、按键和测试灯，并由实时任务提交熄灯帧；网页失联会执行 16 通道 Sustain Off 与 All Notes Off。

生产网页的 JS/CSS 只保存 `.gz` 文件。Arduino-ESP32 `WebServer` 在请求原始 `.js`/`.css` URL 时自动选择同名 `.gz` 并发送正确的 `Content-Encoding: gzip`；`index.html` 保持未压缩，确保根路由和救援提示始终可读。

## 无线维护

双 OTA 固件槽和独立 LittleFS 分区由 `partitions.csv` 固定。`/api/update` 只接受 SoftAP 接口并再次校验热点密码；上传开始会熄灯并清空 MIDI OUT。`/api/update-info` 只读返回版本、运行槽和动态分区上限。详细操作与恢复见 `docs/update.md`。
