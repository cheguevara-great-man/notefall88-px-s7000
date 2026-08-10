# 刷机与首次使用

## 推荐：使用发布页单文件首刷包

全新乐鑫官方 `ESP32-S3-DevKitC-1 N8R8` 可直接从 [GitHub Releases](https://github.com/cheguevara-great-man/notefall88-px-s7000/releases) 下载 `notefall88-factory-<版本>.zip`。完整解压后阅读包内 `FLASHING.md`，安装固定版本 esptool，再运行：

```powershell
python flash_factory.py --port COM5
```

该路径只需 Python，不需要克隆源码、Node、CadQuery 或 PlatformIO。脚本先验证板型、镜像大小与 SHA-256，明确输入 `ERASE` 后才擦除目标板，并以单一地址 `0x0` 写入包含 bootloader、分区表、OTA 初始数据、固件和 LittleFS 的合并镜像。它不会自动猜串口。以下源码构建流程用于开发、审计和故障恢复。

## 自动构建

在仓库根目录执行：

```powershell
python -m pip install -r requirements-dev.txt
python scripts/generate.py --check
cd web
npm.cmd ci
npm.cmd test -- --run
npm.cmd run build
cd ..
.\.venv\Scripts\platformio.exe run -d firmware
.\.venv\Scripts\platformio.exe run -d firmware -t buildfs
```

`platformio.ini` 把临时构建目录放到纯英文用户缓存，是为了规避旧版 Xtensa Windows 链接器不能在中文路径创建 map 文件的问题；源代码和输出仍由仓库管理。`firmware/boards/notefall-esp32-s3-devkitc1-n8r8.json` 固定乐鑫 N8R8 的 8 MB Quad Flash、8 MB Octal PSRAM、原生 USB 与烧录参数，避免把同外形的 N8 无 PSRAM配置误用于实板；项目自身 C/C++ 代码以 `-Wall -Wextra -Werror` 编译。

## 烧录

1. 用数据线把开发板标 `UART` 的 Micro-USB 口接电脑；此时不要连接钢琴。
2. 执行：

```powershell
.\.venv\Scripts\platformio.exe run -d firmware -t upload
.\.venv\Scripts\platformio.exe run -d firmware -t uploadfs
```

3. 如果自动找不到串口，在命令后加 `--upload-port COMx`，其中 `COMx` 以设备管理器显示为准。
4. 首次必须同时烧固件和文件系统。网页改动后只需 `uploadfs`；固件改动后执行 `upload`。

首次成功打开网页后，进入“设备设置 → 设备维护”，连接 `NoteFall-88` 热点并把默认热点密码改为至少 12 位的独有密码。密码保存在 ESP32 NVS，不会由诊断接口或网页回显；忘记时仍可用 UART 重新烧录/清除 NVS 恢复。

## 后续无线更新

正式 GitHub 标签会自动构建 `firmware.bin`、`littlefs.bin`、SHA-256 清单和组合 ZIP。无线更新必须：

1. 先导出曲库和练习历史；
2. 手机/平板切换到设备自身 `NoteFall-88` 热点，而不是只通过家庭 Wi-Fi 访问；
3. 在“设备维护”再次输入当前热点密码；
4. 分别选择固件或网页 `.bin`，核对页面显示的分区上限后上传；
5. 看到“设备确认成功”前绝不拔电。固件成功后设备自动重启，再确认版本、USB 和校准仍正常。

无线更新不能替代首次 UART 烧录，也不能修复供电、USB 或完全无法启动的问题。完整威胁边界、失败恢复和发布包格式见 [安全更新说明](update.md)。

## 使用

手机或平板连接 `NoteFall-88`，首次密码 `notefall88`，浏览器打开 `http://192.168.4.1`。首次进入后立即在“设备维护”修改该公开默认密码；修改前安装向导不会允许完成。设置页可把 ESP32 加入家中 Wi-Fi；保存后会重启，热点仍保留作为故障恢复入口。通过家庭 Wi-Fi 打开时默认只能看诊断，输入当前热点密码后才会为当前标签页解锁灯光、校准和 MIDI OUT；密码不写入浏览器存储，页面只保存本次 ESP 启动有效的会话令牌。

网页是本地文件，不需要互联网、账号或手机 App。手机只负责显示瀑布；钢琴按键经 USB 直接进入 ESP32。
