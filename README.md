# SquidDeck

一款面向 Windows 11 与 Switch 2 的虚拟手柄及 Splatoon 涂鸦助手。它将电脑内置的 USB 蓝牙适配器临时交给 WSL 2，在 Linux/BlueZ 中模拟 Nintendo Switch Pro Controller，支持键鼠操控，并把 320×120 黑白像素图自动绘制到游戏画布。

> 当前版本为 `0.1.0` 技术预览版，兼容基线为 Switch 2。Intel USB 蓝牙、Pro Controller 握手与短宏输入已经验证；Splatoon 3 画布长图和更多蓝牙芯片仍需继续验证。不要在重要存档或无人看管时首次测试。

## 已实现

- 单文件 Windows 便携 EXE。
- 应用内安装、修复和卸载 WSL/usbipd/BlueZ/NXBT 依赖。
- 独立的 SquidDeck WSL 环境，不修改用户已有 Linux 环境。
- 自动发现 USB 蓝牙适配器，支持接管、归还和退出时恢复。
- 使用 usbipd 结构化状态识别新版设备列表；异常退出后可恢复上次接管记录并安全归还。
- 内置 WSL、USB/IP、BlueZ、NXBT 与 Linux 蓝牙控制器兼容性诊断。
- 完整 Pro Controller 界面：全部按键、双摇杆、L3/R3、鼠标/触控/键盘输入。
- 图片导入、完整/裁满/拉伸、亮度、对比度、阈值、反色。
- Floyd–Steinberg、Atkinson、Bayer 与纯阈值四种黑白转换。
- 320×120 像素预览、路径统计、耗时估算、谨慎模式、停止绘制与分行续画。
- 内置 8×7 真机校准图，用约 11 秒验证画笔、方向与行距。
- Windows PowerShell 5.1 兼容的安装脚本，以及只清理本应用所创建依赖的安全策略。

## 使用流程

1. 运行 `release/SquidDeck-0.1.0-portable.exe`。
2. 在“准备舱”点击“一键安装依赖”，同意管理员提示。首次启用 WSL 后可能需要重启，再点一次继续。
3. 选择检测到的内置蓝牙并点击“临时接管蓝牙”。接管期间 Windows 蓝牙会暂时不可用。
4. 在 Switch 2 打开“手柄 → 更改握法/顺序”，进入“虚拟手柄”连接。
5. 进入 Splatoon 3 横向涂鸦画布，选择最小画笔，用 L3 清空并把光标移至左上角。
6. 首次使用先在“涂鸦工坊”载入 8×7 真机校准图，确认落笔正确后再导入正式图片。
7. 绘制结束后手动检查和发布。断开手柄或退出应用会把蓝牙归还 Windows。

## 兼容性边界

- 推荐 Windows 11 x64；WSL USB/IP 的官方基线是 Windows 11 Build 22000 或更新版本。
- “零外部硬件”仍要求电脑本身具有可由 `usbipd-win` 接管的 USB 蓝牙控制器。少数 PCIe/UART 蓝牙、复合设备或厂商驱动可能无法接管。
- WSL 接管蓝牙期间，Windows 不能同时使用该适配器；这是 USB/IP 的系统限制。
- 不会自动点击游戏内发布按钮，避免未经确认公开内容。
- 如果电脑已有 WSL/usbipd，清理器会保留共享组件；`VirtualMachinePlatform` 也会保留，因为 Docker 和模拟器可能使用它。
- 对外分发前应使用受信任的 Windows 代码签名证书签名；未签名技术预览版可能被 SmartScreen 或企业 Application Control 阻止。

## 开发

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd test
npm.cmd run build
npm.cmd run dist
```

构建产物：`release/SquidDeck-0.1.0-portable.exe`。

主要目录：

- `src/`：React 界面、图像处理与绘制路径生成。
- `electron/`：Windows 系统检测、USB/IP 生命周期、IPC 和 WSL 进程管理。
- `backend/`：WSL 内运行的 NXBT JSON-lines 桥。
- `scripts/`：管理员权限下执行的依赖安装与安全清理脚本。

## 技术依据与致谢

- [Microsoft：将 USB 设备连接到 WSL](https://learn.microsoft.com/windows/wsl/connect-usb)
- [usbipd-win](https://github.com/dorssel/usbipd-win)
- [NXBT](https://github.com/Brikwerk/nxbt)（MIT）
- [img2splat](https://github.com/JonathanNye/img2splat)（Unlicense，作为 320×120 绘制流程参考）

本项目使用原创界面与品牌元素，不包含任天堂或 Splatoon 官方素材，也与任天堂无隶属或背书关系。
