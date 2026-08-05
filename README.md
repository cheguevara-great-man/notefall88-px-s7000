# NoteFall 88

NoteFall 88 是面向 Casio PX-S7000 的可拆卸单排琴键提示灯。钢琴通过 USB-MIDI 直接连接 ESP32-S3；ESP32-S3 驱动一条覆盖 88 键的 APA102C/SK9822 灯带，并通过 Wi-Fi 向手机、平板或电脑提供瀑布流练习网页。

> 钢琴上只有一排灯。瀑布流只在屏幕里显示。

![竖直裸灯带安装原理](mechanical/renders/vertical_strip_mount.png)

> 琴键一侧不使用贯穿全长的 3D 打印盒。灯带竖直安装、发光面朝演奏者且前方无遮挡，宽角度光束的下半部分直接照亮对应琴键。可选黑色薄承载片只负责保持灯带笔直，不包裹灯珠，也不是打印件。

## 最终架构

```text
PX-S7000 USB TO HOST ──USB-MIDI──> ESP32-S3-DevKitC-1 N8R8
                                             │
                                SPI ──> 74AHCT125 ──> 单排灯带
                                             │
                                           Wi-Fi
                                             │
                              手机 / 平板 / 电脑浏览器
```

网页端导入 MIDI 文件、绘制瀑布流并提供实时/等待练习、左右手筛选、可调提前量、A–B 循环和命中/错键/漏键统计；钢琴按键数据走 USB 直达 ESP32，因此按键反馈不依赖无线链路。ESP32 默认建立 `NoteFall-88` 热点，浏览器打开 `http://192.168.4.1` 即可使用。

## 硬件基线

- 乐鑫 ESP32-S3-DevKitC-1-N8R8
- 5 V、144 像素/米、IP30、黑色 PCB 的 APA102C 或 SK9822，一条连续灯带
- 最终使用前 176 像素，覆盖约 1222 mm 的 88 键键床
- 74AHCT125 成品电平转换模块
- 5 V / 5 A 有认证成品电源，灯带首尾两端注电
- Micro-USB 供电 OTG Y 线和普通 USB-A 转 USB-B 打印机数据线

完整采购见 [BOM 表](docs/bom.csv)，接线见 [硬件说明](docs/hardware.md)。

## 仓库内容

- `firmware/`：ESP32-S3 固件、USB-MIDI Host、Wi-Fi/WebSocket 和 APA102/SK9822 驱动
- `web/`：手机/平板/电脑通用网页，包含 MIDI 导入、瀑布流和等待练习
- `mechanical/`：可选控制器保护盒的 CadQuery 参数化模型；琴键侧没有打印导轨
- `config/system.json`：88 键、灯带、电气和机械参数的唯一来源
- `scripts/generate.py`：生成灯位映射、固件头文件和制造文件
- `tests/`：映射、功耗和机械包络测试
- `docs/`：接线、装配、校准、测试和开源项目技术调研

## 从这里开始

1. 下单前按 [一次性现场复核](docs/measurements.md) 确认琴键后方固定立面可放下 12 mm 宽灯带，不需要打印试件或购买额外灯带。
2. 按 [BOM](docs/bom.csv) 买最终件，再按 [装配说明](docs/assembly.md) 让卖家代焊线束并组装。
3. 按 [刷机说明](docs/flashing.md) 写入固件和网页。
4. 严格依次执行 [断电检查、校准和验收](docs/testing.md)。

## 本地验证

```powershell
python -m pip install -r requirements-dev.txt
python scripts/generate.py --check
python -m pytest

cd web
npm.cmd ci
npm.cmd test -- --run
npm.cmd run build

cd ..
.\.venv\Scripts\platformio.exe run -d firmware
.\.venv\Scripts\platformio.exe run -d firmware -t buildfs
python scripts/render_cad.py
```

网页构建结果直接写入 `firmware/data/`，随后可用 `platformio run -d firmware -t uploadfs` 写入开发板文件系统。

## 当前事实边界

软件、映射、CAD 和固件可以数字验证；PX-S7000 与具体灯带批次的 USB 枚举、实际灯位偏移、温升和琴漆材料相容性仍必须在实物上完成最终验收。网页校准允许反向灯带和修正全局像素偏移，不需要重新写固件。

项目采用 MIT 许可证。现有项目的硬件拓扑、通信方式、功能、优缺点和采用边界见 [开源项目技术调研](docs/open-source-review.md)；为什么把 AGPL-3.0 的 Piano Trainer Studio 提升为第一软件参考但不直接 fork，见 [PTS 采用决策](docs/pts-adoption-decision.md)。
