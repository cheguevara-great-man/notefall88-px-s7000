# 安全更新、发布包与恢复

实机网络与自动回滚的操作说明见 [家庭网络、救援热点与防变砖机制](deploy/network-and-recovery.md)。当前固件允许在家庭 LAN 或永久救援热点中进行带管理密码的 OTA；无需为日常升级切换 Wi-Fi。`/recovery` 页面编译在应用固件中，不依赖 LittleFS。

全新或已擦除的开发板不能使用网页 OTA，应从 GitHub Release 下载 `notefall88-factory-*.zip`，用包内校验脚本通过 UART 口完成单文件首刷。factory 包会清除 NVS 中的设备配置、Wi-Fi 和灯位校准；日常升级应使用 `notefall88-update-*.zip`，不要反复刷 factory 镜像。

## 目标与威胁边界

NoteFall 可选加入家庭 Wi-Fi，因此“同一局域网里能打开网页”不能等于“有权刷固件”。写入接口同时要求：

1. 家庭 STA 与永久 SoftAP 两条路径都可更新，二者都必须提供设备管理密码；
2. `X-NoteFall-Admin` 必须与当前热点密码恒定时间比较一致；密码不会进入 URL、日志、状态或响应；新密码在网页和固件两端都按 UTF-8 字节计数，必须为 8–63 字节；
3. 文件必须通过目标分区和 Arduino Update 的固件/写入校验。

默认管理密码公开在仓库中，不应被视为多人网络中的长期秘密；当前单用户实机可暂时保留。所有写接口在家庭 LAN 和救援热点上都要求同一个管理密码，浏览器只长期保存随机控制令牌，不保存明文密码。它不是密码学签名启动链，不能防止掌握管理密码的攻击者。签名镜像若成为量产要求，应在锁定硬件后启用 ESP32 Secure Boot 与 Flash Encryption，并建立不可丢失的签名密钥流程，不能在原型阶段草率熔断 eFuse。

## 分区与失败行为

| 分区 | 大小 | 行为 |
|---|---:|---|
| `app0` / `app1` | 各 `0x280000`（2.5 MiB） | 固件写入非运行 OTA 槽，成功后切换启动槽 |
| `littlefs` | `0x2E0000`（2.875 MiB） | 独立网页镜像 |
| `nvs` | `0x5000` | 校准、家庭 Wi-Fi 和热点密码；正常 OTA 不覆盖 |

更新开始前固件会清除目标灯、取消伴奏排程并发送 16 通道 Sustain Off / All Notes Off。浏览器只有收到设备 `{ok:true,written:...}` 才显示成功；超时、断线或非 JSON 响应均保持“不确定/失败”，不会把上传进度 100% 当成写入成功。

如果新固件无法完成启动与真实网络访问，它会在 90 秒内自动回滚；上传中途失败不会切换启动槽。若普通网页损坏，使用固件内置的 `http://192.168.4.1/recovery` 重刷。只有两个 OTA 槽和救援页都遭到异常破坏时才需要 UART。不要用反复断电尝试“碰运气”，也不要在电源不稳、灯带过热或 USB 反复掉线时更新。

## 发布包

合法版本标签触发 `.github/workflows/release.yml`：重复运行 Python、网页覆盖率、Chromium/WebKit、固件和 LittleFS 门禁，再发布：

- `notefall88-update-<tag>.zip` 与 `manifest.json`：已装设备的双槽 OTA；
- `notefall88-factory-<tag>.zip` 与 `factory-manifest.json`：全新 N8R8 的单文件 UART 首刷；
- `notefall88-manufacturing-<tag>.zip` 与 `manufacturing-manifest.json`：线束、机械和制造资料。

构建中间的裸 `firmware.bin` 和 `littlefs.bin` 不单独作为 Release 附件，避免用户把 OTA 镜像误写到地址 `0x0`。`vMAJOR.MINOR.PATCH-rc.N` 必须与固件版本匹配并自动标为 Pre-release；每个标签还必须有同名人工发布说明。

`manifest.json` 是版本 1 信封，记录产品名、固件版本、协议、分区表 SHA-256，以及两个 OTA 镜像的目标、字节数和 SHA-256。factory 清单另外逐项记录 bootloader、分区表、OTA 初始数据、应用和 LittleFS 的偏移、大小与哈希；合并结果已经与 esptool 4.5.1 独立 `merge_bin` 输出交叉验证。三类 ZIP 都固定包含项目 `LICENSE` 与 `THIRD_PARTY_NOTICES.md`，并在清单中记录字节数与 SHA-256。这样从 Release 单独取得二进制或制造资料的人也同时取得 MIT/BSD/LGPL 等适用声明。可在本地复现 OTA 包；首刷包参数见 `scripts/package_factory.py --help`：

```powershell
python scripts/package_update.py `
  --firmware C:\path\to\firmware.bin `
  --filesystem C:\path\to\littlefs.bin `
  --output dist\notefall88-update.zip
```

在 PX-S7000 实机验收、温升和断电恢复通过前不打正式稳定版标签；草稿 PR 的 CI 成功不等于物理发布许可。
