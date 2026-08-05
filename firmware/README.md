# ESP32-S3 固件

固件面向乐鑫官方 `ESP32-S3-DevKitC-1-N8R8`。原生 `USB/OTG` Micro-USB 口作为钢琴 USB Host；另一个 `UART` Micro-USB 口用于烧录和日志。

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
- 协议：v2

亮度上限 `4/31` 写在生成头文件中。修改网页滑块不能越过该值。

## 实机诊断

网页“灯带校准 → 设备诊断”显示 USB VID/PID、MIDI IN 端点、端点包长、累计 MIDI 包、队列丢包、传输错误、连接次数、空闲堆和 Wi-Fi RSSI。正常连续弹奏时 `丢包 / 错误` 应保持 `0 / 0`。

USB Host 传输回调运行在专用 FreeRTOS 任务，只写入固定长度环形队列和原子诊断计数。`poll()` 在 Arduino 主任务中分发 MIDI 与连接状态，网络库不会从 USB 任务中被调用。
