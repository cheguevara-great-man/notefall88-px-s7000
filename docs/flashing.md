# 刷机与首次使用

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

`platformio.ini` 把临时构建目录放到纯英文用户缓存，是为了规避旧版 Xtensa Windows 链接器不能在中文路径创建 map 文件的问题；源代码和输出仍由仓库管理。

## 烧录

1. 用数据线把开发板标 `UART` 的 Micro-USB 口接电脑；此时不要连接钢琴。
2. 执行：

```powershell
.\.venv\Scripts\platformio.exe run -d firmware -t upload
.\.venv\Scripts\platformio.exe run -d firmware -t uploadfs
```

3. 如果自动找不到串口，在命令后加 `--upload-port COMx`，其中 `COMx` 以设备管理器显示为准。
4. 首次必须同时烧固件和文件系统。网页改动后只需 `uploadfs`；固件改动后执行 `upload`。

## 使用

手机或平板连接 `NoteFall-88`，密码 `notefall88`，浏览器打开 `http://192.168.4.1`。导入标准 MIDI 文件即可。设置页可把 ESP32 加入家中 Wi-Fi；保存后会重启，热点仍保留作为故障恢复入口。

网页是本地文件，不需要互联网、账号或手机 App。手机只负责显示瀑布；钢琴按键经 USB 直接进入 ESP32。
