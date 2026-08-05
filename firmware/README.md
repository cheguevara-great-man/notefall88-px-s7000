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
- 固件：0.6.3
- 协议：v5

亮度上限 `4/31` 写在生成头文件中。修改网页滑块不能越过该值。

## 实机诊断

网页“灯带校准 → 设备诊断”显示 USB VID/PID、MIDI IN/OUT 端点与包长、双向累计包数、OUT 排程深度、队列丢包、传输错误、回声抑制、连接次数、空闲堆、PSRAM、NVS、上次复位原因和 Wi-Fi RSSI。N8R8 启动时会检查 OPI PSRAM；网页应显示约 8 MiB 总量。正常连续弹奏和跟随伴奏时两组 `丢包 / 错误` 都应保持 `0 / 0`，并且不得出现 `brownout`、`panic` 或 `watchdog` 复位。

USB Host 传输回调运行在专用 FreeRTOS 任务：IN 回调只写入固定长度环形队列和原子诊断计数，OUT 由另一固定队列批量提交且同一端点最多一个在途传输。`poll()` 在 Arduino 主任务中分发 MIDI 与连接状态，网络库不会从 USB 任务中被调用。网页只传相对时间事件，固件以 `millis()` 排程；网页失联会执行 16 通道 Sustain Off 与 All Notes Off。

生产网页的 JS/CSS 只保存 `.gz` 文件。Arduino-ESP32 `WebServer` 在请求原始 `.js`/`.css` URL 时自动选择同名 `.gz` 并发送正确的 `Content-Encoding: gzip`；`index.html` 保持未压缩，确保根路由和救援提示始终可读。

## 无线维护

双 OTA 固件槽和独立 LittleFS 分区由 `partitions.csv` 固定。`/api/update` 只接受 SoftAP 接口并再次校验热点密码；上传开始会熄灯并清空 MIDI OUT。`/api/update-info` 只读返回版本、运行槽和动态分区上限。详细操作与恢复见 `docs/update.md`。
