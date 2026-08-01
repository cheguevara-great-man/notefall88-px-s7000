# ESP32-S3 V0 固件

## 引脚与接线

默认引脚由 `config/system.json` 生成到 `include/layout_generated.h`：

| ESP32-S3 | 连接 | 说明 |
|---|---|---|
| GPIO11 | 74AHCT125 A1 → Y1 → 100 Ω → strip DATA IN | 数据 |
| GPIO12 | 74AHCT125 A2 → Y2 → 100 Ω → strip CLOCK IN | 时钟 |
| GND | 74AHCT125 GND、灯带 GND、电源 GND | 必须共地 |
| USB | 电脑 | 串口和开发板供电 |

74AHCT125 的 VCC 接灯阵 5 V，`/OE1`、`/OE2` 接 GND；所有未使用输入固定接 GND，未使用 `/OE` 接 5 V。灯带 5 V 直接来自带保险的独立电源，不经过开发板。灯带入口并 1000 µF / 10 V 电容。

## 编译

```powershell
pio run -d firmware
pio run -d firmware -t upload
pio device monitor -b 921600
```

固件只接受协议版本 1、4 排 × 12 音的完整逻辑帧。亮度硬钳制到 4/31；1 秒没有合法显示帧即熄灯。上电时不会自动跑高亮自检，避免接线错误时扩大损害。

