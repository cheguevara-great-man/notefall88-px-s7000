# 安全更新、发布包与恢复

## 目标与威胁边界

NoteFall 可选加入家庭 Wi-Fi，因此“同一局域网里能打开网页”不能等于“有权刷固件”。写入接口同时要求：

1. TCP 连接的本地接口必须是 ESP32 自己的 SoftAP 地址；从 STA/家庭 Wi-Fi 到达的请求直接拒绝；
2. `X-NoteFall-Admin` 必须与当前热点密码恒定时间比较一致；密码不会进入 URL、日志、状态或响应；
3. 文件必须通过目标分区和 Arduino Update 的固件/写入校验。

默认热点密码只用于首次连接，公开在仓库中，不应被视为长期秘密。首次安装必须在设备热点内改成独有密码。当前方案防止普通家庭局域网客户端和未加入热点的远程页面刷写；它不是密码学签名启动链，不能防止掌握热点密码的攻击者。签名镜像若成为量产要求，应在锁定硬件后启用 ESP32 Secure Boot 与 Flash Encryption，并建立不可丢失的签名密钥流程，不能在原型阶段草率熔断 eFuse。

## 分区与失败行为

| 分区 | 大小 | 行为 |
|---|---:|---|
| `app0` / `app1` | 各 `0x280000`（2.5 MiB） | 固件写入非运行 OTA 槽，成功后切换启动槽 |
| `littlefs` | `0x2E0000`（2.875 MiB） | 独立网页镜像 |
| `nvs` | `0x5000` | 校准、家庭 Wi-Fi 和热点密码；正常 OTA 不覆盖 |

更新开始前固件会清除目标灯、取消伴奏排程并发送 16 通道 Sustain Off / All Notes Off。浏览器只有收到设备 `{ok:true,written:...}` 才显示成功；超时、断线或非 JSON 响应均保持“不确定/失败”，不会把上传进度 100% 当成写入成功。

如果更新后无法启动，使用 UART 口执行 `platformio run -d firmware -t upload` 和 `-t uploadfs`。不要用反复断电尝试“碰运气”，也不要在电源不稳、灯带过热或 USB 反复掉线时更新。

## 发布包

标签 `v*` 触发 `.github/workflows/release.yml`：运行网页测试，构建固件/LittleFS，再发布：

- `firmware.bin`；
- `littlefs.bin`；
- `manifest.json`；
- `notefall88-update-<tag>.zip`。

`manifest.json` 是版本 1 信封，记录产品名、固件版本、协议、分区表 SHA-256，以及两个镜像的目标、字节数和 SHA-256。OTA ZIP 另外固定包含项目 `LICENSE` 与 `THIRD_PARTY_NOTICES.md`，并在 manifest 的 `notices` 中记录两者的字节数与 SHA-256；制造包同样包含两者。这样从 Release 单独取得二进制或制造资料的人也同时取得 MIT/BSD/LGPL 等适用声明。可在本地复现：

```powershell
python scripts/package_update.py `
  --firmware C:\path\to\firmware.bin `
  --filesystem C:\path\to\littlefs.bin `
  --output dist\notefall88-update.zip
```

在 PX-S7000 实机验收、温升和断电恢复通过前不打正式稳定版标签；草稿 PR 的 CI 成功不等于物理发布许可。
