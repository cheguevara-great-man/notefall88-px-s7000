# WebSocket 协议 v6

NoteFall Core 在 TCP `81` 提供 WebSocket。消息均为 UTF-8 JSON；浏览器负责乐谱和练习语义，ESP32 负责 USB、灯位、排程与安全。协议不传 Wi-Fi 密码以外的敏感数据，诊断消息也不会回显已保存密码。

## 握手与状态

浏览器连接后发送：

```json
{"t":"hello","v":6}
```

从设备自己的 `NoteFall-88` 热点连接时，上述握手自动取得控制权；从家庭 Wi-Fi/STA 连接时，网页必须在同一条握手中附带当前热点密码：

```json
{"t":"hello","v":6,"auth":"current-hotspot-password"}
```

密码只在首次解锁时发送并由固件做常量时间比较，网页不会保存它。验证成功后，固件仅向这个已授权的 STA 会话返回 NVS 中的随机 `controlToken`；网页把该令牌保存在 `localStorage`，重连及正常重启后继续使用：

```json
{"t":"hello","v":6,"token":"persistent-random-control-token"}
```

令牌在正常 ESP 重启或关闭标签页后继续有效，但修改管理密码会立即换发并撤销旧令牌。它不进入 IndexedDB 曲库、练习记录、备份或诊断导出，也不能用于 Wi-Fi 配置、修改密码或固件更新；不应复制或导出。本地链路使用 `ws://`，不宣称端到端 TLS；家庭 WLAN 的链路加密和独有热点密码共同构成当前原型的网络边界。若 SoftAP 与家庭局域网子网重叠，固件按不可信 STA 处理并要求密码，不根据模糊地址自动授权。

ESP 返回 `status`；只有授权会话才返回 `calibration`、逐键 MIDI 与踏板事件。`status` 的稳定字段包括：

- `protocol`、`firmware`、`piano`、`clients`；
- `controlSessionReady`、`controlAuthorized`、`accessPointClient`、`webAuthRejected`；已授权 STA 的个性化状态还包含 `controlToken`，未授权或 SoftAP 客户端不返回该字段；
- `usbVid`、`usbPid`、`usbEndpoint`、`usbPacketSize`；
- `usbOut`、`usbOutEndpoint`、`usbOutPacketSize`；
- `usbPackets`、`usbDropped`、`usbMalformed`、`usbErrors`、`usbLastError`；其中 `usbMalformed` 只统计 CIN/status/data 边界不一致的坏包，合法但产品不消费的 SysEx、时钟与 Active Sensing 会被安全忽略而不误报；`usbLastError` 是不含凭据的最近枚举/传输原因，并随验收报告导出；
- `usbOutPackets`、`usbOutDropped`、`usbOutErrors`、`usbOutQueued`、`usbOutputMirrorCandidates`、`usbOutOwned`；
- `usbInputQueueDepth` / `usbInputQueueHighWater`、`usbOutputQueueDepth` / `usbOutputQueueHighWater`、`usbLargestInputBatch`、`usbInputResubmitRetries` 与两个 USB 任务的看门狗状态；
- `midiDispatchLatency*`（USB 回调到实时任务消费）、`ledInputLatency*`（USB 回调到 SPI 帧完成）；
- `ledFrames`、`ledFramesSkipped`、`ledSpiLastUs`、`ledSpiMaxUs`、`ledFrameBytes`；
- `realtimeReady`、`realtimeWatchdog`、`realtimeHeartbeatAgeMs`、`realtimeWakeups`、`realtimeStackFreeBytes`；
- `webMidiQueueDepth`、`webMidiQueueHighWater`、`webMidiDropped`、`webMidiResyncs`、`brightness`、`offset`、`reversed`、内存、NVS 状态、启动复位原因、运行时间和 RSSI。

`resetReason` 使用稳定字符串，例如 `power-on`、`software-reset`、`panic`、`watchdog` 或 `brownout`。它记录当前这次启动的来源；若满亮度或强奏测试后出现 `brownout`/`watchdog`，应先排查供电、短路、堆栈或阻塞，不得把自动重启当作正常恢复。

未知字段必须忽略。固件先把新连接标为未握手：只有匹配 `hello.v` 且控制授权成立后，才接受目标灯、校准、测试灯、熄灯或 MIDI OUT 等改变状态的消息。协议不一致时只允许查看状态诊断，并返回 `{"t":"protocolError","expected":6,"received":5}`；无效 JSON、超过 8192 字节、未握手、协议不符或未授权的控制消息计入只读字段 `webRejected`，错误 STA 密码另计入 `webAuthRejected`。未授权 STA 仍可读基础设备/USB/内存诊断并使用 `ping`，但收不到演奏事件和校准数组。

网页也把设备消息当作不可信输入：消息超过 65536 字节、字段类型错误、非整数/越界 MIDI、不是恰好 88 项或超出 ±4 的校准数组都会在进入练习状态前被拒绝。设备端与浏览器端拒绝数分别显示，避免把网络或版本故障静默转换成错误琴键。

## 钢琴输入

ESP 把 USB MIDI 标准化为：

```json
{"t":"midi","s":"on","ch":1,"n":60,"v":96,"vh":12345,"ts":123456}
{"t":"midi","s":"off","ch":1,"n":60,"v":0,"ts":123820}
{"t":"control","ch":1,"c":64,"v":127,"ts":123500}
```

`ch` 为 1–16，`n/v/c` 为 0–127，`ts` 是 USB 回调微秒时间戳换算出的 ESP32 启动后毫秒数。若 PX-S7000 启用了 High-Resolution Velocity MIDI Out，固件会把同通道 CC88 低 7 位与下一条 Note On/Off 的 `v` 合成为可选 `vh`（0–16383）；原始 CC88 仍单独转发，所以标准 MIDI 录制可无损往返。旧客户端可忽略 `vh`，Note On 力度 0 仍归一化为 Note Off。CC120/123 会清除本地按键状态。

## 目标灯与校准

目标是音符语义而非像素帧：

```json
{"t":"target","notes":[{"n":60,"h":1},{"n":48,"h":0}]}
```

`h=0` 为左手，`h=1` 为右手。网页每 250 ms 检查一次、至少每 1 秒重发当前非空集合；ESP 3 秒未收到目标则清除。校准使用 `config`、`keyOffset`、`test` 和 `blackout`；全局及逐键参数均由固件再次限幅并持久化。

## MIDI OUT 排程

跟随模式、乐谱所选声部示范和刚录演奏回放都发送相对于接收时刻的事件，不让手机逐音承担实时调度：

```json
{
  "t":"midiOut",
  "events":[
    {"delay":0,"s":144,"d1":48,"d2":90},
    {"delay":420,"s":128,"d1":48,"d2":0}
  ]
}
```

- `delay` 为 0–60000 ms；状态字节只接受 0x80–0xEF 的通道消息，数据字节限 0–127。
- 全谱示范与录音回放只前瞻 1.5 s，约每 0.65 s 补充；Note On 和 Note Off 分别按各自时刻进入后续时间窗，因此超过 60 s 的长音不会因 `delay` 上限被提前断开。从曲中开始时会恢复 CC64 状态，但不会为已经错过起点的音符发送孤立 Note Off。
- 录音直接回放保留 1–16 通道、力度与 CC64/66/67；其他 CC 仍保留在导出的标准 MIDI 中，但不自动回写到 PX-S7000，避免意外改变音量或音色。
- 单条网页消息最多发送 48 个事件；固件总排程固定为 256 个，USB OUT 固定队列为 128 个 USB-MIDI 事件包。
- ESP 回复 `midiOutResult`，包含 `ok`、`accepted` 与当前 `queued`；周期 `status` 是最终诊断真相。
- 同一时刻只有一个 WebSocket 客户端可持有 MIDI OUT；其他页面收到 `busy=true`。持有者复位、熄灯或断开即释放并先执行全音符关闭，避免两台手机重复伴奏。
- 固件观察 80 ms 内与刚发送伴奏完全相同的消息并累计 `usbOutputMirrorCandidates`，但仍把它当真实输入交给灯光与判分。PX-S7000 官方实现没有定义 MIDI Thru；在无法区分真实齐奏与设备镜像时，静默吞键比保留可诊断输入更危险。
- `{"t":"midiPanic"}` 只允许当前持有者执行；`blackout` 是任何页面都可触发的总急停。持有者断开、练习复位或末尾伴奏释放时会清空待排程并向 16 个通道发送 CC64=0、CC123=0。

## 延迟探测与网络配置

网页发送 `{"t":"ping","ts":1234}`，ESP 回复 `{"t":"pong","ts":1234,"deviceTs":5678}`。`ts` 原样回显浏览器 `performance.now()` 的整数毫秒令牌，`deviceTs` 是 ESP 处理请求时的 uint32 启动后毫秒数。网页只接受与当前请求匹配的回复，在近期 12 个有效样本中选往返时间最低者，以请求/回复中点估计两端单调时钟偏移；半个 RTT 是当前同步误差上界。算法处理约 49.7 天回绕、ESP 重启、超过 2 秒的同步样本和超过 5 秒的排队事件。旧固件不返回 `deviceTs` 时仍可显示 RTT，但判定与录音明确退回消息到达时刻。

这个同步只消除网络到达抖动对网页判定和录音时间线的污染，不等同于按键到灯光延迟。家庭 Wi-Fi 上的 WebSocket 控制使用当前管理密码做首次会话认证；家庭 Wi-Fi 凭据本身仍不能通过 WebSocket 修改。`POST /api/wifi` 在家庭 LAN 与设备 SoftAP 上都在 `X-NoteFall-Admin` 头再次核对当前管理密码；SSID 为 1–32 个 UTF-8 字节，密码为空或 8–63 个 UTF-8 字节。热点新密码同样按 UTF-8 字节计数，网页与固件使用同一边界，避免多字节字符在两端判定不一致。ESP 始终保留 `NoteFall-88` 热点作为恢复入口。

`midiDispatchLatency*` 测量 USB Host 传输回调收到事件到固定实时任务开始消费的区间；`ledInputLatency*` 继续测到对应 SPI 灯帧发送完毕。USB daemon 和 MIDI client 已拆为两个任务，client 事件等待上限由 20 ms 缩到 5 ms；收到包后直接唤醒 Core 0 实时任务。固件先排空同一批 USB 事件，再只发送一帧，所以和弦不会逐音重复刷灯；该帧先于任何 WebSocket 广播，网络和 JSON 只在 Core 1 的 Arduino 主任务执行。

176 灯 APA102 帧固定为 719 字节（4 字节起始、704 字节像素、11 字节结束），仍以 8 MHz、BGR、同一 5-bit 全局亮度发送，理论线时约 719 µs。实现由 719 次逐字节调用改为一次硬件 SPI 批量调用；状态未改变时不再每 10 ms 重发相同帧。USB client 先把整个 transfer 入队再只唤醒一次优先级更高的实时任务，因此同批和弦仍合成一帧，持续输入也不会饿死灯光任务。浏览器事件使用独立 128 项固定队列，每轮最多发 12 项，溢出计入 `webMidiDropped` 并用现有全通道 `control` CC64/66/67/123 加当前按键 `midi` 事件重同步；因此旧版协议 v6 客户端也能恢复且不会因漏掉 Note Off 或踏板释放永久挂键。此指标不包含 PX-S7000 自身键盘扫描、USB 传输前半段与 LED 光电响应，不能替代 120 fps 端到端视频，但能定位固件、SPI、网络或任务阻塞。

## 演进规则

- 增加可选字段不提升协议版本；改变字段含义、单位、限幅或安全行为必须提升版本。
- 固件不得信任网页校验；网页不得假定某台钢琴一定存在 MIDI OUT。
- 新的高频数据流不得放入 USB 回调直接调用网络库，必须经过固定容量队列。
