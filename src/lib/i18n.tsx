import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Locale = 'zh-CN' | 'en-US' | 'ja-JP';
type Values = Record<string, string | number>;

export const LOCALE_OPTIONS: Array<{ value: Locale; short: string; label: string }> = [
  { value: 'zh-CN', short: '中', label: '简体中文' },
  { value: 'en-US', short: 'EN', label: 'English' },
  { value: 'ja-JP', short: '日', label: '日本語' }
];

const STORAGE_KEY = 'splatoondeck.language.v1';

const en: Record<string, string> = {
  'Windows 阻止了安装助手，通常是应用程序控制或安全策略所致。请使用带有效数字签名的正式发布版本。': 'Windows blocked the setup helper, usually because of Application Control or another security policy. Use an official release with a valid digital signature.',
  '安装窗口正在等待确认，请查看错误详情并按 Enter 关闭窗口。': 'The setup window is waiting for confirmation. Review the error details, then press Enter to close it.',
  '可以继续安装': 'Ready to Continue', '继续安装': 'Continue Installation',
  '准备舱': 'Setup Bay', '环境与蓝牙': 'Environment & Bluetooth', '虚拟手柄': 'Virtual Controller', '完整操控': 'Full Control', '涂鸦工坊': 'Ink Workshop', '导图与绘制': 'Import & Draw',
  '等待连接': 'Waiting to connect', 'SWITCH 2 已连接': 'SWITCH 2 CONNECTED', '环境就绪度 {{count}}/3 · v{{version}}': 'Environment {{count}}/3 · v{{version}}', '界面语言': 'Interface language',
  '虚拟手柄已断开 · 蓝牙仍由 WSL 接管': 'Controller disconnected · Bluetooth remains attached to WSL', '连接失败': 'Connection failed', '控制器发生错误': 'Controller error', '已断开': 'Disconnected',
  '涂鸦绘制完成！': 'Drawing complete!', '绘制已停止，可以调整起始行后继续': 'Drawing stopped. Adjust the starting row or column to resume.', '没有检测到可接管的内置 USB 蓝牙适配器': 'No compatible USB Bluetooth controller was detected.',
  '正在创建虚拟 Pro Controller…': 'Creating virtual Pro Controller…', '正在启动 BlueZ 与 NXBT': 'Starting BlueZ and NXBT', '正在重新连接上次的 Switch 2': 'Reconnecting to the previous Switch 2', '请在 Switch 2 打开手柄 → 更改握法/顺序': 'On Switch 2, open Controllers → Change Grip/Order', '请在 Switch 2 打开更改握法/顺序': 'On Switch 2, open Change Grip/Order', 'Pro Controller 已连接': 'Pro Controller connected', 'Pro Controller 已连接（预览）': 'Pro Controller connected (preview)', '正在关闭虚拟手柄': 'Disconnecting virtual controller', '已有绘制任务正在运行': 'A drawing task is already running',
  '正在清理应用依赖…': 'Removing app dependencies…', '正在安装应用依赖…': 'Installing app dependencies…', '操作已完成': 'Operation completed', '操作失败，请查看日志': 'Operation failed. Check the log.', '正在授权蓝牙设备给 WSL…': 'Sharing the Bluetooth controller with WSL…', '无法共享蓝牙设备': 'Unable to share the Bluetooth controller', '正在把蓝牙临时交给 WSL…': 'Temporarily attaching Bluetooth to WSL…', '蓝牙接管失败': 'Bluetooth attachment failed', '蓝牙已由 WSL 接管': 'Bluetooth is attached to WSL', '蓝牙已归还 Windows': 'Bluetooth returned to Windows', '蓝牙归还失败': 'Failed to return Bluetooth', '正在检查 WSL、USB/IP、BlueZ 与 NXBT…': 'Checking WSL, USB/IP, BlueZ, and NXBT…', '诊断通过': 'Diagnostics passed',
  '就绪': 'Ready', '待完成': 'Pending', '需处理': 'Action needed', '隔离运行 Linux 蓝牙协议栈': 'Runs the Linux Bluetooth stack in isolation', '专用环境': 'Dedicated environment', '只存放 SplatoonDeck 的 BlueZ 与 NXBT': 'Contains only SplatoonDeck BlueZ and NXBT', '把内置蓝牙临时交给 WSL': 'Temporarily attaches Bluetooth to WSL',
  '兼容性诊断通过': 'Compatibility diagnostics passed', '诊断完成：{{count}} 项需要处理': 'Diagnostics complete: {{count}} item(s) need attention', '准备你的': 'Prepare your ', '墨水舱': 'ink bay', '一次配置，之后打开应用即可连接。系统改动都会记录，也能安全清理。': 'Set it up once, then connect whenever you open the app. Every system change is tracked and can be cleaned up.', '刷新': 'Refresh',
  '需要重启 Windows': 'Windows restart required', '前置依赖已准备完成。重启后点击“继续安装”，安装会从下一阶段继续。': 'Prerequisites are ready. Restart Windows, then select Continue Installation to resume from the next stage.', '清理完成，等待重启': 'Cleanup complete — restart pending', 'SplatoonDeck 添加的依赖已经移除；重启 Windows 后系统组件清理将完全生效。': 'Dependencies added by SplatoonDeck have been removed. Restart Windows to finish applying the system cleanup.', '已恢复上次会话': 'Previous session restored', '检测到蓝牙仍由 WSL 接管，可点击“归还蓝牙”安全恢复 Windows 蓝牙。': 'Bluetooth is still attached to WSL. Return it safely to restore Windows Bluetooth.',
  '运行环境': 'Runtime environment', '检查 / 修复依赖': 'Check / Repair Dependencies', '重启后继续安装': 'Continue After Restart', '重启后可重新安装': 'Reinstall After Restart', '一键安装依赖': 'Install Dependencies', '安装需要管理员确认和网络连接；首次安装会分阶段进行，并可能要求重启。': 'Setup requires administrator confirmation and internet access. First-time setup runs in stages and may require a restart.',
  '蓝牙接管': 'Bluetooth handoff', '选择电脑内置蓝牙': 'Select a Bluetooth controller', '未检测到 USB 蓝牙适配器': 'No USB Bluetooth controller detected', '归还蓝牙给 Windows': 'Return Bluetooth to Windows', '临时接管蓝牙': 'Temporarily Attach Bluetooth', '断开虚拟手柄不会归还蓝牙；请在此处点击“归还蓝牙给 Windows”，正常退出应用时也会自动归还。': 'Disconnecting the virtual controller does not return Bluetooth. Use Return Bluetooth to Windows here; a normal app exit also returns it automatically.',
  '不留下一滴墨水': 'Leave no ink behind', '清理只移除本应用创建的 Linux 环境、WSL 运行时、USB 共享记录和 usbipd。安装前已有或正被其他软件使用的组件会保留。': 'Cleanup removes only the Linux environment, WSL runtime, USB sharing records, and usbipd added by this app. Components that existed beforehand or are used by other software are preserved.', '正在清理…': 'Cleaning…', '卸载应用依赖': 'Uninstall App Dependencies', '依赖已卸载': 'Dependencies Removed',
  '环境安装': 'Environment Setup', '环境清理': 'Environment Cleanup', '操作需要处理': 'Action Needed', '等待 Windows 重启': 'Waiting for Windows Restart', '正在执行': 'In Progress', '检查安装前环境': 'Check the original environment', '准备 WSL 运行时': 'Prepare the WSL runtime', '准备 USB/IP 支持': 'Prepare USB/IP support', '启用 Windows 功能': 'Enable Windows features', '创建专用 Linux 环境': 'Create the private Linux environment', '安装 BlueZ、Python 与 NXBT': 'Install BlueZ, Python, and NXBT', '验证完整环境': 'Verify the complete environment',
  '归还蓝牙设备': 'Return Bluetooth to Windows', '移除专用 Linux 环境': 'Remove the private Linux environment', '恢复 USB/IP 环境': 'Restore USB/IP support', '恢复 WSL 运行时': 'Restore the WSL runtime', '恢复 Windows 功能': 'Restore Windows features', '验证清理结果': 'Verify cleanup', '本阶段未完成': 'Stage Not Completed', '当前阶段': 'Current Stage', '下一步': 'Next', '正在下载 Linux 环境：{{percent}}%': 'Downloading Linux environment: {{percent}}%',
  '需要管理员权限才能继续，请重新操作并允许授权。': 'Administrator permission is required. Retry and approve the prompt.', 'Windows 操作等待超时。请重启电脑后重试，已完成的阶段会自动跳过。': 'A Windows operation timed out. Restart the PC and retry; completed stages will be skipped.', '下载或文件处理失败。请检查网络和磁盘空间后重试，已下载内容会继续使用。': 'A download or file operation failed. Check the network and free space, then retry; downloaded data will be reused.', '安装文件不完整，请重新下载 SplatoonDeck 后再试。': 'The setup files are incomplete. Download SplatoonDeck again and retry.', '本阶段执行失败，环境记录和已完成进度均已保留，可以直接重试。': 'This stage failed. The environment record and completed progress were preserved, so you can retry directly.',
  '立即重启': 'Restart Now', '稍后我自己重启': 'Restart Later', '正在重启…': 'Restarting…', '重启后，系统会完成本次依赖清理。未完成的清理项目仍可继续重试。': 'Windows will finish applying this cleanup after restart. Any unresolved cleanup items can still be retried.', '重启后再次打开 SplatoonDeck，点击继续安装即可从下一阶段开始。': 'After restart, reopen SplatoonDeck and continue setup from the next stage.', '操作失败，已保留进度，请重试': 'The operation failed. Progress was preserved; retry when ready.', '重试清理未完成项目': 'Retry Unfinished Cleanup',
  '当前阶段已完成，需要重启 Windows 后继续': 'This stage is complete. Restart Windows to continue.', '管理员授权已取消，没有更改电脑环境': 'Administrator approval was cancelled. No new changes were made.', '操作失败，已保留进度，可查看详情后重试': 'The operation failed. Progress was preserved; review the details and retry.', '另一个依赖安装或清理操作仍在进行，请等待它完成。': 'Another dependency setup or cleanup operation is still running. Wait for it to finish.',
  '硬件兼容性诊断': 'Hardware Compatibility Diagnostics', '检查 WSL 内核、usbipd、BlueZ、NXBT 和 Linux 蓝牙控制器，不会主动接管设备。': 'Checks the WSL kernel, usbipd, BlueZ, NXBT, and the Linux Bluetooth controller without attaching a device.', '诊断中…': 'Diagnosing…', '运行诊断': 'Run Diagnostics', '兼容基线': 'Compatibility baseline', '部分蓝牙芯片或厂商驱动可能不支持 USB/IP 接管，请先运行诊断。': 'Some Bluetooth chipsets or vendor drivers may not support USB/IP attachment. Run diagnostics first.',
  '已安装': 'Installed', '未安装': 'Not installed', '尚未安装': 'Not installed', '未识别到候选设备': 'No candidate device detected', 'WSL 内核': 'WSL kernel', '无法读取': 'Unable to read', 'BlueZ 服务': 'BlueZ service', '未运行': 'Not running', '导入失败': 'Import failed', 'Linux 蓝牙控制器': 'Linux Bluetooth controller', '已接管 USB，但 BlueZ 未发现控制器': 'USB is attached, but BlueZ did not find a controller', '接管蓝牙后可完成此项检查': 'Attach Bluetooth to complete this check', 'WSL USB 设备': 'WSL USB device', '当前没有已接管的 USB 设备': 'No USB device is currently attached', 'USB 蓝牙适配器': 'USB Bluetooth controller', 'SplatoonDeck 环境': 'SplatoonDeck environment',
  '无效的 USB/IP 参数': 'Invalid USB/IP parameter', '蓝牙设备 Bus ID 无效': 'The Bluetooth device Bus ID is invalid', '所选蓝牙设备已断开，请刷新后重试': 'The selected Bluetooth device disconnected. Refresh and try again.', '所选 USB 设备不像蓝牙适配器，已阻止接管': 'The selected USB device does not appear to be a Bluetooth controller, so attachment was blocked.', '该设备已被其他 USB/IP 会话接管，请先归还设备': 'Another USB/IP session has attached this device. Return it before trying again.',
  '预览：依赖检查完成': 'Preview: dependency check complete', '预览：蓝牙已接管': 'Preview: Bluetooth attached', '预览：蓝牙已归还': 'Preview: Bluetooth returned',
  '虚拟 ': 'Virtual ', '鼠标、触控和键盘都能操作；双击摇杆可按下 L3 / R3。': 'Use mouse, touch, or keyboard. Double-click a stick to press L3 / R3.', '自定义映射': 'Custom Mapping', '鼠标控制中 · Esc 退出': 'Mouse control active · Esc to exit', '启用鼠标 → {{stick}}': 'Enable Mouse → {{stick}}', '左摇杆': 'Left Stick', '右摇杆': 'Right Stick', '横向': 'Horizontal', '纵向': 'Vertical', '鼠标横向灵敏度': 'Horizontal mouse sensitivity', '鼠标纵向灵敏度': 'Vertical mouse sensitivity',
  '断开连接': 'Disconnect', '等待 Switch 2 配对': 'Waiting for Switch 2', '正在连接 Switch 2': 'Connecting to Switch 2', '连接 Switch 2': 'Connect to Switch 2', '鼠标正在控制{{stick}}': 'Mouse is controlling {{stick}}', 'Esc 退出': 'Esc to exit', '自动绘制进行中': 'Automatic drawing in progress', '手柄输入已锁定，请在涂鸦工坊停止绘制后操作': 'Controller input is locked. Stop drawing in Ink Workshop before using it.',
  '宏录制与回放': 'Macro Recording & Playback', '记录按键、摇杆和操作间隔，之后按原始节奏重新执行。': 'Record buttons, sticks, and timing, then replay the sequence at its original pace.', '录制中': 'Recording', '回放中': 'Playing', '已录制': 'Recorded', '尚未录制宏': 'No macro recorded', '持续时间': 'Duration', '事件': 'Events', '保存位置': 'Storage', '仅保存在本机': 'This device only', '事件时间线': 'Event Timeline', '按下': 'pressed', '松开': 'released', '录制会捕获屏幕手柄、键盘、鼠标按键和鼠标移动。': 'Recording captures the on-screen controller, keyboard, mouse buttons, and mouse movement.',
  '回放方式': 'Playback Mode', '指定次数': 'Repeat Count', '回放次数': 'Playback count', '次': 'times', '无限循环': 'Loop Until Stopped', '第 {{round}} 轮': 'Round {{round}}', '第 {{round}} 轮 · 无限循环': 'Round {{round}} · Looping', '第 {{round}} / {{total}} 轮': 'Round {{round}} / {{total}}', '开始录制': 'Start Recording', '停止录制': 'Stop Recording', '回放': 'Play', '停止回放': 'Stop Playback', '正在启动回放…': 'Starting playback…', '清空': 'Clear', '宏回放进行中': 'Macro playback in progress', '正在按录制节奏执行，手柄输入已锁定': 'Replaying the recorded timing. Controller input is locked.',
  '宏回放完成': 'Macro playback complete', '宏回放已停止': 'Macro playback stopped', '宏回放启动失败': 'Could not start macro playback', '宏回放停止失败': 'Could not stop macro playback', '录制已保存': 'Recording saved', '录制内容已清空': 'Recording cleared', '没有记录到手柄操作': 'No controller input was recorded', '没有可回放的录制内容': 'There is no recording to play', '已有宏任务正在运行': 'A macro is already running',
  '十字键': 'D-pad', '鼠标移动': 'Mouse Movement', '编辑全部映射 →': 'Edit All Mappings →', '键盘与鼠标映射': 'Keyboard & Mouse Mapping', '点击一个映射槽，再按下想使用的键。重复绑定会自动从旧动作移除。': 'Select a mapping slot, then press the input you want. Duplicate inputs are removed from their previous action.', '恢复默认': 'Restore Defaults', '关闭映射设置': 'Close mapping settings',
  '启用后，在手柄页点击“启用鼠标”，使用指针锁定连续控制摇杆。': 'After enabling it, select Enable Mouse on the controller page to control a stick with pointer lock.', '控制目标': 'Target', '关闭': 'Off', '横向灵敏度': 'Horizontal sensitivity', '纵向灵敏度': 'Vertical sensitivity', '反转 X': 'Invert X', '反转 Y': 'Invert Y', '手柄动作': 'Controller Action', '键盘': 'Keyboard', '鼠标按键': 'Mouse Button', '请按键…': 'Press a key…', '请按鼠标键…': 'Press a mouse button…', '鼠标按键映射在页面空白区域生效，避免与直接点击虚拟手柄冲突。': 'Mouse-button mappings work on empty page areas to avoid conflicts with clicking the virtual controller.', '清空按键映射': 'Clear Button Mappings', '完成': 'Done', '面键': 'Face Buttons', '肩键': 'Shoulder Buttons', '系统键': 'System Buttons',
  '上': 'Up', '下': 'Down', '左': 'Left', '右': 'Right', '向上': 'Up', '向下': 'Down', '向左': 'Left', '向右': 'Right', '截图': 'Capture', '未设置': 'Not set', '小键盘 {{key}}': 'Numpad {{key}}', '鼠标左键': 'Left Mouse', '鼠标中键': 'Middle Mouse', '鼠标右键': 'Right Mouse', '鼠标后退键': 'Mouse Back', '鼠标前进键': 'Mouse Forward', '鼠标键 {{button}}': 'Mouse Button {{button}}', '左 Shift': 'Left Shift', '右 Shift': 'Right Shift', '左 Ctrl': 'Left Ctrl', '右 Ctrl': 'Right Ctrl', '左 Alt': 'Left Alt', '右 Alt': 'Right Alt',
  '320 × 120 像素绘制预览': '320 × 120 pixel drawing preview', '请选择 PNG、JPG 或 WebP 图片': 'Choose a PNG, JPG, WebP, or BMP image.', '图片读取失败': 'Could not read the image.', 'Splatoon 3 · 8×7 真机校准图': 'Splatoon 3 · 8×7 hardware calibration image', '校准图已载入：开始后会自动清空、选择最小画笔并定位光标': 'Calibration image loaded. Starting will clear the canvas, select the smallest brush, and position the cursor.', '请先连接虚拟 Pro Controller': 'Connect the virtual Pro Controller first.', '请先导入图片': 'Import an image first.', '绘制指令发送失败，请检查虚拟手柄连接': 'Could not send the drawing command. Check the virtual controller connection.', '停止指令发送失败，请稍后重试': 'Could not send the stop command. Try again shortly.',
  '导入图片、实时抖动预览，再让虚拟手柄逐像素复刻到游戏画布。': 'Import an image, preview dithering in real time, then let the virtual controller reproduce it pixel by pixel.', '导入图片': 'Import Image', '原图': 'Source image', '点击更换图片': 'Click to replace image', '把图片扔进来': 'Drop an image here', '或点击选择 PNG / JPG / WebP': 'or click to choose PNG / JPG / WebP', '会自动适配为黑白像素图': 'Automatically converted to monochrome pixels', '载入 8×7 真机校准图': 'Load 8×7 Hardware Calibration', '已载入并本地处理': 'Loaded and processed locally',
  '图像调校': 'Image Tuning', '完整': 'Contain', '裁满': 'Cover', '拉伸': 'Stretch', '亮度': 'Brightness', '对比度': 'Contrast', '黑白阈值': 'B/W Threshold', '抖动算法': 'Dithering', '细腻': 'Detailed', '清爽': 'Clean', '网点': 'Halftone', '纯阈值 · 线稿': 'Threshold · Line Art', '反转黑白': 'Invert Black & White', '适合深色底图': 'Useful for dark backgrounds',
  '游戏画布预览': 'Game Canvas Preview', '路径已校验': 'Path Verified', '等待你的作品': 'Waiting for your artwork', '左侧导入图片后会在这里实时预览': 'Import an image on the left to preview it here.', '黑色像素': 'Black Pixels', '白色像素': 'White Pixels', '输入指令': 'Input Commands', '自动绘制': 'Automatic Drawing', '自动': 'Auto', '逐行': 'By Row', '逐列': 'By Column', '单步脉冲 (ms)': 'Step Pulse (ms)', '续画起始行': 'Resume Start Row', '续画起始列': 'Resume Start Column', '本批结束行': 'Batch End Row', '本批结束列': 'Batch End Column',
  '绘制已中止': 'Drawing interrupted', '根据停止时进度，建议从第 {{position}} {{unit}}附近续画；请对照游戏画面修正。': 'Based on the stopping point, resume near {{unit}} {{position}}. Compare with the game canvas before continuing.', '使用第 {{position}} {{unit}}': 'Use {{unit}} {{position}}', '预计耗时': 'Estimated Time', '绘制范围': 'Drawing Range', '启动准备': 'Preparation', '全自动': 'Automatic', '跳过空白': 'Blank Bands Skipped', '内容范围': 'Content Range', '扫描方向': 'Scan Direction', '行': 'row', '列': 'column', '正在准备画布…': 'Preparing canvas…', '正在喷墨…': 'Drawing…', '剩余时间': 'Time Remaining', '停止绘制': 'Stop Drawing', '正在发送绘制指令…': 'Sending drawing command…', '开始自动绘制': 'Start Automatic Drawing', '连接手柄后开始': 'Connect Controller to Start', '每次方向移动都包含独立按下与松开帧；逐行绘制会自适应选择左右边界，逐列绘制固定从顶部边界校准。预览和绘制共用同一份 320 × 120 二值矩阵。': 'Each directional move has a separate press and release. Row scans choose either horizontal edge; column scans calibrate from the top. Preview and drawing share the same 320 × 120 binary matrix.',
  '{{minutes}} 分 {{seconds}} 秒': '{{minutes}}m {{seconds}}s', '{{seconds}} 秒': '{{seconds}}s',
  'SplatoonDeck 启动失败': 'SplatoonDeck failed to start', '安全桥接模块没有加载。请关闭应用后重新打开；如果仍然出现此页面，请重新下载完整的 EXE 文件。': 'The secure bridge did not load. Close and reopen the app. If this page still appears, download the complete EXE again.'
};

const ja: Record<string, string> = {
  'Windows 阻止了安装助手，通常是应用程序控制或安全策略所致。请使用带有效数字签名的正式发布版本。': 'Windows によりセットアップヘルパーがブロックされました。通常はアプリ制御またはセキュリティポリシーが原因です。有効なデジタル署名付きの正式版を使用してください。',
  '安装窗口正在等待确认，请查看错误详情并按 Enter 关闭窗口。': 'セットアップ画面が確認を待っています。エラー内容を確認し、Enter キーを押して閉じてください。',
  '可以继续安装': 'インストールを続行できます', '继续安装': 'インストールを続行',
  '准备舱': 'セットアップ', '环境与蓝牙': '環境と Bluetooth', '虚拟手柄': '仮想コントローラー', '完整操控': 'フル操作', '涂鸦工坊': 'インクラボ', '导图与绘制': '画像と描画',
  '等待连接': '接続待ち', 'SWITCH 2 已连接': 'SWITCH 2 接続済み', '环境就绪度 {{count}}/3 · v{{version}}': '環境準備 {{count}}/3 · v{{version}}', '界面语言': '表示言語',
  '虚拟手柄已断开 · 蓝牙仍由 WSL 接管': 'コントローラー切断済み · Bluetooth は WSL に接続中', '连接失败': '接続に失敗しました', '控制器发生错误': 'コントローラーエラー', '已断开': '切断しました',
  '涂鸦绘制完成！': '描画が完了しました！', '绘制已停止，可以调整起始行后继续': '描画を停止しました。開始行または列を変更して再開できます。', '没有检测到可接管的内置 USB 蓝牙适配器': '使用可能な USB Bluetooth コントローラーが見つかりません。',
  '正在创建虚拟 Pro Controller…': '仮想 Pro Controller を作成中…', '正在启动 BlueZ 与 NXBT': 'BlueZ と NXBT を起動中', '正在重新连接上次的 Switch 2': '前回の Switch 2 に再接続中', '请在 Switch 2 打开手柄 → 更改握法/顺序': 'Switch 2 で「コントローラー → 持ちかた/順番を変える」を開いてください', '请在 Switch 2 打开更改握法/顺序': 'Switch 2 で「持ちかた/順番を変える」を開いてください', 'Pro Controller 已连接': 'Pro Controller 接続済み', 'Pro Controller 已连接（预览）': 'Pro Controller 接続済み（プレビュー）', '正在关闭虚拟手柄': '仮想コントローラーを切断中', '已有绘制任务正在运行': '描画タスクがすでに実行中です',
  '正在清理应用依赖…': 'アプリ依存関係を削除中…', '正在安装应用依赖…': 'アプリ依存関係をインストール中…', '操作已完成': '操作が完了しました', '操作失败，请查看日志': '操作に失敗しました。ログを確認してください。', '正在授权蓝牙设备给 WSL…': 'Bluetooth コントローラーを WSL と共有中…', '无法共享蓝牙设备': 'Bluetooth コントローラーを共有できません', '正在把蓝牙临时交给 WSL…': 'Bluetooth を WSL に一時接続中…', '蓝牙接管失败': 'Bluetooth の接続に失敗しました', '蓝牙已由 WSL 接管': 'Bluetooth は WSL に接続されています', '蓝牙已归还 Windows': 'Bluetooth を Windows に戻しました', '蓝牙归还失败': 'Bluetooth を Windows に戻せませんでした', '正在检查 WSL、USB/IP、BlueZ 与 NXBT…': 'WSL、USB/IP、BlueZ、NXBT を確認中…', '诊断通过': '診断に合格しました',
  '就绪': '準備完了', '待完成': '保留', '需处理': '要対応', '隔离运行 Linux 蓝牙协议栈': 'Linux Bluetooth スタックを分離実行', '专用环境': '専用環境', '只存放 SplatoonDeck 的 BlueZ 与 NXBT': 'SplatoonDeck の BlueZ と NXBT のみを保存', '把内置蓝牙临时交给 WSL': 'Bluetooth を WSL に一時接続',
  '兼容性诊断通过': '互換性診断に合格しました', '诊断完成：{{count}} 项需要处理': '診断完了：{{count}} 件の対応が必要です', '准备你的': '', '墨水舱': 'インク環境を準備', '一次配置，之后打开应用即可连接。系统改动都会记录，也能安全清理。': '一度設定すれば、次回からすぐに接続できます。システム変更は記録され、安全に削除できます。', '刷新': '更新',
  '需要重启 Windows': 'Windows の再起動が必要です', '前置依赖已准备完成。重启后点击“继续安装”，安装会从下一阶段继续。': '前提コンポーネントの準備が完了しました。Windows を再起動し、「インストールを続行」を押すと次の段階から再開します。', '清理完成，等待重启': 'クリーンアップ完了・再起動待ち', 'SplatoonDeck 添加的依赖已经移除；重启 Windows 后系统组件清理将完全生效。': 'SplatoonDeck が追加した依存関係を削除しました。Windows を再起動するとシステムのクリーンアップが完了します。', '已恢复上次会话': '前回のセッションを復元しました', '检测到蓝牙仍由 WSL 接管，可点击“归还蓝牙”安全恢复 Windows 蓝牙。': 'Bluetooth が WSL に接続されたままです。「Windows に戻す」で安全に復元できます。',
  '运行环境': '実行環境', '检查 / 修复依赖': '依存関係を確認 / 修復', '重启后继续安装': '再起動後に続行', '重启后可重新安装': '再起動後に再インストール', '一键安装依赖': '依存関係をインストール', '安装需要管理员确认和网络连接；首次安装会分阶段进行，并可能要求重启。': 'セットアップには管理者確認とネット接続が必要です。初回セットアップは段階的に進み、再起動が必要な場合があります。',
  '蓝牙接管': 'Bluetooth 接続', '选择电脑内置蓝牙': 'Bluetooth コントローラーを選択', '未检测到 USB 蓝牙适配器': 'USB Bluetooth コントローラーが見つかりません', '归还蓝牙给 Windows': 'Bluetooth を Windows に戻す', '临时接管蓝牙': 'Bluetooth を一時接続', '断开虚拟手柄不会归还蓝牙；请在此处点击“归还蓝牙给 Windows”，正常退出应用时也会自动归还。': '仮想コントローラーを切断しても Bluetooth は戻りません。ここで Windows に戻してください。アプリの通常終了時にも自動で戻ります。',
  '不留下一滴墨水': '跡を残さずクリーンアップ', '清理只移除本应用创建的 Linux 环境、WSL 运行时、USB 共享记录和 usbipd。安装前已有或正被其他软件使用的组件会保留。': 'このアプリが追加した Linux 環境、WSL ランタイム、USB 共有記録、usbipd のみを削除します。インストール前から存在したものや他のソフトが使用中のコンポーネントは残します。', '正在清理…': '削除中…', '卸载应用依赖': 'アプリ依存関係を削除', '依赖已卸载': '依存関係は削除済み',
  '环境安装': '環境のインストール', '环境清理': '環境のクリーンアップ', '操作需要处理': '対応が必要です', '等待 Windows 重启': 'Windows の再起動待ち', '正在执行': '実行中', '检查安装前环境': '元の環境を確認', '准备 WSL 运行时': 'WSL ランタイムを準備', '准备 USB/IP 支持': 'USB/IP を準備', '启用 Windows 功能': 'Windows 機能を有効化', '创建专用 Linux 环境': '専用 Linux 環境を作成', '安装 BlueZ、Python 与 NXBT': 'BlueZ・Python・NXBT をインストール', '验证完整环境': '環境全体を確認',
  '归还蓝牙设备': 'Bluetooth を Windows に戻す', '移除专用 Linux 环境': '専用 Linux 環境を削除', '恢复 USB/IP 环境': 'USB/IP 環境を復元', '恢复 WSL 运行时': 'WSL ランタイムを復元', '恢复 Windows 功能': 'Windows 機能を復元', '验证清理结果': 'クリーンアップを確認', '本阶段未完成': 'この段階は未完了です', '当前阶段': '現在の段階', '下一步': '次の段階', '正在下载 Linux 环境：{{percent}}%': 'Linux 環境をダウンロード中：{{percent}}%',
  '需要管理员权限才能继续，请重新操作并允许授权。': '続行には管理者権限が必要です。再試行して許可してください。', 'Windows 操作等待超时。请重启电脑后重试，已完成的阶段会自动跳过。': 'Windows の処理がタイムアウトしました。PC を再起動して再試行してください。完了済みの段階はスキップされます。', '下载或文件处理失败。请检查网络和磁盘空间后重试，已下载内容会继续使用。': 'ダウンロードまたはファイル処理に失敗しました。ネット接続と空き容量を確認して再試行してください。取得済みデータは再利用されます。', '安装文件不完整，请重新下载 SplatoonDeck 后再试。': 'セットアップファイルが不完全です。SplatoonDeck を再ダウンロードして再試行してください。', '本阶段执行失败，环境记录和已完成进度均已保留，可以直接重试。': 'この段階に失敗しました。環境記録と完了済みの進捗は保存されているため、そのまま再試行できます。',
  '立即重启': '今すぐ再起動', '稍后我自己重启': '後で再起動', '正在重启…': '再起動中…', '重启后，系统会完成本次依赖清理。未完成的清理项目仍可继续重试。': '再起動後に今回のクリーンアップが適用されます。未完了の項目は引き続き再試行できます。', '重启后再次打开 SplatoonDeck，点击继续安装即可从下一阶段开始。': '再起動後に SplatoonDeck を開き、次の段階からインストールを続けてください。', '操作失败，已保留进度，请重试': '操作に失敗しました。進捗は保存されています。再試行してください。', '重试清理未完成项目': '未完了のクリーンアップを再試行',
  '当前阶段已完成，需要重启 Windows 后继续': 'この段階は完了しました。Windows を再起動して続行してください。', '管理员授权已取消，没有更改电脑环境': '管理者の許可がキャンセルされました。新しい変更は行われていません。', '操作失败，已保留进度，可查看详情后重试': '操作に失敗しました。進捗は保存されています。詳細を確認して再試行してください。', '另一个依赖安装或清理操作仍在进行，请等待它完成。': '別の依存関係のインストールまたはクリーンアップが実行中です。完了するまでお待ちください。',
  '硬件兼容性诊断': 'ハードウェア互換性診断', '检查 WSL 内核、usbipd、BlueZ、NXBT 和 Linux 蓝牙控制器，不会主动接管设备。': 'WSL カーネル、usbipd、BlueZ、NXBT、Linux Bluetooth コントローラーを、機器を接続せずに確認します。', '诊断中…': '診断中…', '运行诊断': '診断を実行', '兼容基线': '互換性基準', '部分蓝牙芯片或厂商驱动可能不支持 USB/IP 接管，请先运行诊断。': '一部の Bluetooth チップやドライバーは USB/IP に対応しない場合があります。先に診断を実行してください。',
  '已安装': 'インストール済み', '未安装': '未インストール', '尚未安装': '未インストール', '未识别到候选设备': '候補デバイスが見つかりません', 'WSL 内核': 'WSL カーネル', '无法读取': '読み取れません', 'BlueZ 服务': 'BlueZ サービス', '未运行': '停止中', '导入失败': '読み込み失敗', 'Linux 蓝牙控制器': 'Linux Bluetooth コントローラー', '已接管 USB，但 BlueZ 未发现控制器': 'USB は接続済みですが、BlueZ がコントローラーを検出していません', '接管蓝牙后可完成此项检查': 'Bluetooth 接続後に確認できます', 'WSL USB 设备': 'WSL USB デバイス', '当前没有已接管的 USB 设备': '接続中の USB デバイスはありません', 'USB 蓝牙适配器': 'USB Bluetooth コントローラー', 'SplatoonDeck 环境': 'SplatoonDeck 環境',
  '无效的 USB/IP 参数': 'USB/IP パラメーターが無効です', '蓝牙设备 Bus ID 无效': 'Bluetooth デバイスの Bus ID が無効です', '所选蓝牙设备已断开，请刷新后重试': '選択した Bluetooth デバイスが切断されました。更新して再試行してください。', '所选 USB 设备不像蓝牙适配器，已阻止接管': '選択した USB デバイスは Bluetooth コントローラーではないため、接続を中止しました。', '该设备已被其他 USB/IP 会话接管，请先归还设备': 'このデバイスは別の USB/IP セッションで使用中です。先にデバイスを戻してください。',
  '预览：依赖检查完成': 'プレビュー：依存関係の確認完了', '预览：蓝牙已接管': 'プレビュー：Bluetooth 接続済み', '预览：蓝牙已归还': 'プレビュー：Bluetooth を戻しました',
  '虚拟 ': '仮想 ', '鼠标、触控和键盘都能操作；双击摇杆可按下 L3 / R3。': 'マウス、タッチ、キーボードで操作できます。スティックのダブルクリックで L3 / R3 を押せます。', '自定义映射': 'カスタム割り当て', '鼠标控制中 · Esc 退出': 'マウス操作中 · Esc で終了', '启用鼠标 → {{stick}}': 'マウスを有効化 → {{stick}}', '左摇杆': '左スティック', '右摇杆': '右スティック', '横向': '横', '纵向': '縦', '鼠标横向灵敏度': 'マウス横感度', '鼠标纵向灵敏度': 'マウス縦感度',
  '断开连接': '接続解除', '等待 Switch 2 配对': 'Switch 2 の接続待ち', '正在连接 Switch 2': 'Switch 2 に接続中', '连接 Switch 2': 'Switch 2 に接続', '鼠标正在控制{{stick}}': 'マウスで{{stick}}を操作中', 'Esc 退出': 'Esc で終了', '自动绘制进行中': '自動描画中', '手柄输入已锁定，请在涂鸦工坊停止绘制后操作': 'コントローラー入力はロック中です。インクラボで描画を停止してから操作してください。',
  '宏录制与回放': 'マクロ録画・再生', '记录按键、摇杆和操作间隔，之后按原始节奏重新执行。': 'ボタン、スティック、操作間隔を記録し、元のテンポで再生します。', '录制中': '録画中', '回放中': '再生中', '已录制': '録画済み', '尚未录制宏': 'マクロ未録画', '持续时间': '長さ', '事件': 'イベント', '保存位置': '保存先', '仅保存在本机': 'この端末のみ', '事件时间线': 'イベントタイムライン', '按下': '押す', '松开': '離す', '录制会捕获屏幕手柄、键盘、鼠标按键和鼠标移动。': '画面上のコントローラー、キーボード、マウスボタン、マウス移動を記録します。',
  '回放方式': '再生方法', '指定次数': '回数指定', '回放次数': '再生回数', '次': '回', '无限循环': '停止まで繰り返す', '第 {{round}} 轮': '{{round}} 周目', '第 {{round}} 轮 · 无限循环': '{{round}} 周目 · ループ中', '第 {{round}} / {{total}} 轮': '{{round}} / {{total}} 周目', '开始录制': '録画開始', '停止录制': '録画停止', '回放': '再生', '停止回放': '再生停止', '正在启动回放…': '再生を開始中…', '清空': '消去', '宏回放进行中': 'マクロ再生中', '正在按录制节奏执行，手柄输入已锁定': '録画したタイミングで再生中です。コントローラー入力はロックされています。',
  '宏回放完成': 'マクロ再生が完了しました', '宏回放已停止': 'マクロ再生を停止しました', '宏回放启动失败': 'マクロ再生を開始できませんでした', '宏回放停止失败': 'マクロ再生を停止できませんでした', '录制已保存': '録画を保存しました', '录制内容已清空': '録画を消去しました', '没有记录到手柄操作': 'コントローラー操作が記録されていません', '没有可回放的录制内容': '再生できる録画がありません', '已有宏任务正在运行': '別のマクロを実行中です',
  '十字键': '方向パッド', '鼠标移动': 'マウス移動', '编辑全部映射 →': 'すべての割り当てを編集 →', '键盘与鼠标映射': 'キーボード・マウス割り当て', '点击一个映射槽，再按下想使用的键。重复绑定会自动从旧动作移除。': '割り当て欄を選び、使用する入力を押してください。重複した入力は以前の操作から自動で外れます。', '恢复默认': '初期設定に戻す', '关闭映射设置': '割り当て設定を閉じる',
  '启用后，在手柄页点击“启用鼠标”，使用指针锁定连续控制摇杆。': '有効化後、コントローラー画面で「マウスを有効化」を押すと、ポインターロックでスティックを操作できます。', '控制目标': '操作対象', '关闭': 'オフ', '横向灵敏度': '横感度', '纵向灵敏度': '縦感度', '反转 X': 'X 反転', '反转 Y': 'Y 反転', '手柄动作': 'コントローラー操作', '键盘': 'キーボード', '鼠标按键': 'マウスボタン', '请按键…': 'キーを押す…', '请按鼠标键…': 'マウスボタンを押す…', '鼠标按键映射在页面空白区域生效，避免与直接点击虚拟手柄冲突。': 'マウスボタン割り当ては空白領域で有効になり、画面上のコントローラー操作との競合を避けます。', '清空按键映射': 'ボタン割り当てを消去', '完成': '完了', '面键': 'ABXY ボタン', '肩键': 'ショルダーボタン', '系统键': 'システムボタン',
  '上': '上', '下': '下', '左': '左', '右': '右', '向上': '上', '向下': '下', '向左': '左', '向右': '右', '截图': 'キャプチャー', '未设置': '未設定', '小键盘 {{key}}': 'テンキー {{key}}', '鼠标左键': 'マウス左ボタン', '鼠标中键': 'マウス中央ボタン', '鼠标右键': 'マウス右ボタン', '鼠标后退键': 'マウス戻る', '鼠标前进键': 'マウス進む', '鼠标键 {{button}}': 'マウスボタン {{button}}', '左 Shift': '左 Shift', '右 Shift': '右 Shift', '左 Ctrl': '左 Ctrl', '右 Ctrl': '右 Ctrl', '左 Alt': '左 Alt', '右 Alt': '右 Alt',
  '320 × 120 像素绘制预览': '320 × 120 ピクセル描画プレビュー', '请选择 PNG、JPG 或 WebP 图片': 'PNG、JPG、WebP、BMP 画像を選択してください。', '图片读取失败': '画像を読み込めませんでした。', 'Splatoon 3 · 8×7 真机校准图': 'Splatoon 3 · 8×7 実機キャリブレーション画像', '校准图已载入：开始后会自动清空、选择最小画笔并定位光标': 'キャリブレーション画像を読み込みました。開始時にキャンバス消去、最小ブラシ選択、カーソル位置合わせを行います。', '请先连接虚拟 Pro Controller': '先に仮想 Pro Controller を接続してください。', '请先导入图片': '先に画像を読み込んでください。', '绘制指令发送失败，请检查虚拟手柄连接': '描画コマンドを送信できません。仮想コントローラー接続を確認してください。', '停止指令发送失败，请稍后重试': '停止コマンドを送信できません。しばらくしてから再試行してください。',
  '导入图片、实时抖动预览，再让虚拟手柄逐像素复刻到游戏画布。': '画像を読み込み、ディザリングを確認し、仮想コントローラーでゲーム画面へ 1 ピクセルずつ描画します。', '导入图片': '画像を読み込む', '原图': '元画像', '点击更换图片': 'クリックして画像を変更', '把图片扔进来': '画像をここにドロップ', '或点击选择 PNG / JPG / WebP': 'またはクリックして PNG / JPG / WebP を選択', '会自动适配为黑白像素图': '白黒ピクセル画像へ自動変換', '载入 8×7 真机校准图': '8×7 実機キャリブレーションを読み込む', '已载入并本地处理': '読み込み済み・ローカル処理',
  '图像调校': '画像調整', '完整': '全体', '裁满': '切り抜き', '拉伸': '引き伸ばし', '亮度': '明るさ', '对比度': 'コントラスト', '黑白阈值': '白黒しきい値', '抖动算法': 'ディザリング', '细腻': '高精細', '清爽': 'クリーン', '网点': '網点', '纯阈值 · 线稿': 'しきい値 · 線画', '反转黑白': '白黒反転', '适合深色底图': '暗い背景向け',
  '游戏画布预览': 'ゲームキャンバスプレビュー', '路径已校验': '経路確認済み', '等待你的作品': '作品を待っています', '左侧导入图片后会在这里实时预览': '左側で画像を読み込むと、ここにプレビューされます。', '黑色像素': '黒ピクセル', '白色像素': '白ピクセル', '输入指令': '入力コマンド', '自动绘制': '自動描画', '自动': '自動', '逐行': '行ごと', '逐列': '列ごと', '单步脉冲 (ms)': '1 ステップ時間 (ms)', '续画起始行': '再開開始行', '续画起始列': '再開開始列', '本批结束行': '終了行', '本批结束列': '終了列',
  '绘制已中止': '描画を中断しました', '根据停止时进度，建议从第 {{position}} {{unit}}附近续画；请对照游戏画面修正。': '停止位置から、{{unit}} {{position}} 付近での再開を推奨します。ゲーム画面と比較して調整してください。', '使用第 {{position}} {{unit}}': '{{unit}} {{position}} を使用', '预计耗时': '予想時間', '绘制范围': '描画範囲', '启动准备': '開始準備', '全自动': '全自動', '跳过空白': '空白をスキップ', '内容范围': '内容範囲', '扫描方向': 'スキャン方向', '行': '行', '列': '列', '正在准备画布…': 'キャンバスを準備中…', '正在喷墨…': '描画中…', '剩余时间': '残り時間', '停止绘制': '描画を停止', '正在发送绘制指令…': '描画コマンドを送信中…', '开始自动绘制': '自動描画を開始', '连接手柄后开始': 'コントローラー接続後に開始', '每次方向移动都包含独立按下与松开帧；逐行绘制会自适应选择左右边界，逐列绘制固定从顶部边界校准。预览和绘制共用同一份 320 × 120 二值矩阵。': '各方向移動には独立した押下と解放があります。行描画は左右の端を選び、列描画は上端から調整します。プレビューと描画は同じ 320 × 120 の二値行列を使用します。',
  '{{minutes}} 分 {{seconds}} 秒': '{{minutes}}分{{seconds}}秒', '{{seconds}} 秒': '{{seconds}}秒',
  'SplatoonDeck 启动失败': 'SplatoonDeck の起動に失敗しました', '安全桥接模块没有加载。请关闭应用后重新打开；如果仍然出现此页面，请重新下载完整的 EXE 文件。': 'セキュアブリッジを読み込めませんでした。アプリを閉じて再起動してください。この画面が続く場合は、完全な EXE を再ダウンロードしてください。'
};

const dictionaries: Record<Exclude<Locale, 'zh-CN'>, Record<string, string>> = { 'en-US': en, 'ja-JP': ja };

export function translate(locale: Locale, key: string, values: Values = {}) {
  const template = locale === 'zh-CN' ? key : dictionaries[locale][key] ?? key;
  return Object.entries(values).reduce((result, [name, value]) => result.replaceAll(`{{${name}}}`, String(value)), template);
}

export function detectLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'zh-CN' || saved === 'en-US' || saved === 'ja-JP') return saved;
  const system = navigator.language.toLowerCase();
  if (system.startsWith('ja')) return 'ja-JP';
  if (system.startsWith('en')) return 'en-US';
  return 'zh-CN';
}

export function translateExternal(locale: Locale, message: string) {
  const diagnostic = message.match(/^诊断完成：\s*(\d+)\s*项需要处理$/);
  if (diagnostic) return translate(locale, '诊断完成：{{count}} 项需要处理', { count: diagnostic[1] });
  const nxbt = message.match(/^NXBT 加载失败：(.*)$/);
  if (nxbt && locale !== 'zh-CN') return `${locale === 'ja-JP' ? 'NXBT の読み込みに失敗しました' : 'NXBT failed to load'}: ${nxbt[1]}`;
  const missingScript = message.match(/^缺少安装脚本：(.*)$/);
  if (missingScript && locale !== 'zh-CN') return `${locale === 'ja-JP' ? 'インストールスクリプトが見つかりません' : 'Missing installation script'}: ${missingScript[1]}`;
  return translate(locale, message);
}

type I18nValue = {
  locale: Locale;
  setLocale(locale: Locale): void;
  t(key: string, values?: Values): string;
  tx(message: string): string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(detectLocale);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale;
  }, [locale]);
  const t = useCallback((key: string, values?: Values) => translate(locale, key, values), [locale]);
  const tx = useCallback((message: string) => translateExternal(locale, message), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t, tx }), [locale, t, tx]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
