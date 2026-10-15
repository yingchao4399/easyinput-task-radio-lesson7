# 第七课实物调试记录（2026-10-15）

## 设备识别与只读检查

- 电脑当前识别到 USB HID 设备：VID `303A`、PID `1006`，产品名 `EasyInput AI`，制造商 `AIOTWAN`，序列号 `easy-input-v2`，USB release 字段为 `0x010A`。这证明设备已枚举，不能单凭该字段推断应用固件版本。
- USB 报告描述符包含键盘、鼠标、自定义三组 HID collection。自定义 collection（usage page `0xFF00`）能被主机打开，暴露输入 report ID `0x11`、`0x15`。空闲 4 秒未观察到主动输入 report。Windows 对键盘和鼠标 collection 的直接 HID 读取返回 `read error`；另备有 Windows Raw Input 只读监听脚本。
- 当前没有识别到该板的 USB CDC 串口或 USB 音频端点，因此还没有通过串口读到固件日志，也不能把电脑声卡播放当作板载扬声器验证。
- Windows 保存着 `EasyInput AI` 蓝牙配对/服务设备记录；现场 BLE 扫描发现 23 个周边设备，其中没有 EasyInput 广播。一次按历史地址直连返回 `BleakDeviceNotFoundError`。因此蓝牙现场连通状态**未通过验证**，USB 连接则有实际枚举和接口打开证据。
- 整个识别过程没有发送 HID 输出/功能 report，没有改写固件。

## 实体输入与桌面程序

- 在 Windows Raw Input 中，单独短按 S1 一次，捕获到来自 `VID_303A&PID_1006` USB 键盘 collection 的 `Ctrl+Shift+Alt+1` 按下和松开事件。
- 单独短按 S5 一次，捕获到同一 USB 设备的 `Ctrl+Shift+Alt+5` 按下和松开事件。
- 用户转动实体旋钮时，捕获到同一 USB 设备的纵向鼠标滚轮事件（`button_flags=0x0400`）；短按旋钮后再次转动捕获到横向滚轮事件（`button_flags=0x0800`，本轮 `button_data=0xfe98`）。这证明方向切换后滚轮输入可达电脑；未核定每格事件数，也没有把旋钮接入第七课页面。
- 已安装的 EasyInput 桌面程序显示：`USB 连接`、`键盘输入已连接`、`设置可用`、`已同步`，并把 KEY1～KEY8 标为 `Ctrl+Alt+Shift+1`～`8`。这与独立的 S1/S5 Raw Input 记录一致。
- 浏览器样机新增对应快捷键处理。用浏览器模拟发送上述组合键，槽位 1 成功入队、完成后未读从 0 变 1；S5 触发电脑端固定提醒音，播放结束后未读从 1 变 0。

## USB 实体键到浏览器样机的联调结果

直接依赖浏览器焦点接收快捷键的一次实体 S1 尝试未触发页面。因此增加 Windows Raw Input → 本地 HTTP → Server-Sent Events → 浏览器的只读输入桥接；桥接只转发这块板的 `VID_303A&PID_1006` USB 键盘数字键按下事件，不向板子写命令。

- **实体 S5：通过。** Raw Input 记录 `Ctrl+Shift+Alt+5`，桥接日志 `forwarded S5 204`；页面出现“开始播放结果 #4”，电脑固定提醒音完整播完后出现有效回执，槽位 1 未读从 1 变 0。
- **实体 S1：通过。** 已在槽位 1 填入“实体 S1 经 USB 桥接提交”；Raw Input 记录 `Ctrl+Shift+Alt+1`，桥接日志 `forwarded S1 204`；页面显示“实体 S1 已触发”，任务 #9 入队、完成，槽位 1 未读从 0 变 1。
- **实体 S2～S4：通过。** 分别为槽位 2、3、4 预填测试文字，依次短按相应实物键；页面分别收到输入、入队并生成未听结果。
- **实体 S6～S8：通过。** 对应槽位已有未听结果时，依次短按相应实物键；各槽位触发电脑提醒音，完整播放后对应未听数清零。
- **旋钮：仅输入验证。** 正、反向旋转可产生滚轮事件；短按后再次旋转捕获到横向滚轮事件。它没有被映射到本样机的业务功能。
- 这里的“通过”只针对 USB 物理按键到本地浏览器样机的链路。文字仍代替语音识别，执行器仍为本地模拟器，提醒音由电脑播放；没有证明课程 Host、真实 Codex、实体灯或板载扬声器工作。

## 播放中抢占：尚未取得实体时序证据

浏览器状态机自动检查覆盖“新指令抢占播放时，旧结果仍未读”，但实体 S1 的两次同步尝试均没有落在可核对的原始 USB 监听和播放窗口内。一次播放还命中了浏览器预载的原短音。不能把这些尝试写成“实体 PTT 抢占通过”。若复测，应先启动持久监听、重新载入测试音、确认音频正在播放，再短按实体 S1；同时保留 Raw Input 事件、页面中断事件和未读数。

## 仍需真机验收的动作

按课程 C4 的目标，下一步仍需检查实体按键录音、课程 Host 入槽、灯、板载扬声器、PTT 抢占、断电恢复。当前第七课样机使用文字模拟 ASR 和本地模拟执行器，没有课程固件与 Host 通讯协议实现；USB HID 按键到页面的操作不等于音频与 LED 链路验收。

## 复现命令

在 `lesson7-task-radio` 目录执行：

```powershell
python -m pip install hidapi bleak
python hardware_probe.py --seconds 30
python hardware_raw_input.py --seconds 30
python hardware_ble_probe.py
```

要让实体按键控制已启动的样机，再运行：

```powershell
python hardware_raw_input.py --seconds 600 --forward-url http://127.0.0.1:4177/hardware/input
```

这几个脚本只读取 Windows 设备枚举、HID 输入和 BLE 标准特征；桥接只把按键编号发送到本机 `127.0.0.1`，不向设备写入命令。
