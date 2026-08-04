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

亮度上限 `4/31` 写在生成头文件中。修改网页滑块不能越过该值。
