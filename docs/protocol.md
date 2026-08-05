# WebSocket 协议 v5

NoteFall Core 在 TCP `81` 提供 WebSocket。消息均为 UTF-8 JSON；浏览器负责乐谱和练习语义，ESP32 负责 USB、灯位、排程与安全。协议不传 Wi-Fi 密码以外的敏感数据，诊断消息也不会回显已保存密码。

## 握手与状态

浏览器连接后发送：

```json
{"t":"hello","v":5}
```

ESP 返回 `status` 和 `calibration`。`status` 的稳定字段包括：

- `protocol`、`firmware`、`piano`、`clients`；
- `usbVid`、`usbPid`、`usbEndpoint`、`usbPacketSize`；
- `usbOut`、`usbOutEndpoint`、`usbOutPacketSize`；
- `usbPackets`、`usbDropped`、`usbErrors`；
- `usbOutPackets`、`usbOutDropped`、`usbOutErrors`、`usbOutQueued`、`usbEchoSuppressed`、`usbOutOwned`；
- `brightness`、`offset`、`reversed`、内存、运行时间和 RSSI。

未知字段必须忽略。固件先把新连接标为未握手：只有收到匹配的 `hello.v` 后，才接受目标灯、校准、Wi-Fi 或 MIDI OUT 等改变状态的消息。协议不一致时只允许查看状态诊断，并返回 `{"t":"protocolError","expected":5,"received":4}`；无效 JSON、超过 8192 字节、未握手或协议不符的消息计入只读字段 `webRejected`。

## 钢琴输入

ESP 把 USB MIDI 标准化为：

```json
{"t":"midi","s":"on","ch":1,"n":60,"v":96,"ts":123456}
{"t":"midi","s":"off","ch":1,"n":60,"v":0,"ts":123820}
{"t":"control","ch":1,"c":64,"v":127,"ts":123500}
```

`ch` 为 1–16，`n/v/c` 为 0–127，`ts` 是 ESP32 的 `millis()`。Note On 力度 0 在固件内归一化为 Note Off。CC120/123 会清除本地按键状态。

## 目标灯与校准

目标是音符语义而非像素帧：

```json
{"t":"target","notes":[{"n":60,"h":1},{"n":48,"h":0}]}
```

`h=0` 为左手，`h=1` 为右手。网页每 250 ms 检查一次、至少每 1 秒重发当前非空集合；ESP 3 秒未收到目标则清除。校准使用 `config`、`keyOffset`、`test` 和 `blackout`；全局及逐键参数均由固件再次限幅并持久化。

## MIDI OUT 排程

跟随模式发送相对于接收时刻的事件，不让手机逐音承担实时调度：

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
- 单条网页消息最多发送 48 个事件；固件总排程固定为 256 个，USB OUT 固定队列为 128 个 USB-MIDI 事件包。
- ESP 回复 `midiOutResult`，包含 `ok`、`accepted` 与当前 `queued`；周期 `status` 是最终诊断真相。
- 同一时刻只有一个 WebSocket 客户端可持有 MIDI OUT；其他页面收到 `busy=true`。持有者复位、熄灯或断开即释放并先执行全音符关闭，避免两台手机重复伴奏。
- 输出消息的精确回声在 80 ms 内被消费，避免钢琴若启用 MIDI Thru 时伴奏被计为用户命中。
- `{"t":"midiPanic"}` 只允许当前持有者执行；`blackout` 是任何页面都可触发的总急停。持有者断开、练习复位或末尾伴奏释放时会清空待排程并向 16 个通道发送 CC64=0、CC123=0。

## 延迟探测与网络配置

`ping`/`pong` 只测网页到 ESP 的往返时间，不等同于按键到灯光延迟。家庭 Wi-Fi 凭据不再通过普通 WebSocket 修改：`POST /api/wifi` 只接受设备 SoftAP 本地请求，并在 `X-NoteFall-Admin` 头再次核对当前热点密码；SSID 为 1–32 字节，密码为空或 8–63 字节。ESP 始终保留 `NoteFall-88` 热点作为恢复入口。

## 演进规则

- 增加可选字段不提升协议版本；改变字段含义、单位、限幅或安全行为必须提升版本。
- 固件不得信任网页校验；网页不得假定某台钢琴一定存在 MIDI OUT。
- 新的高频数据流不得放入 USB 回调直接调用网络库，必须经过固定容量队列。
