## 中文

v0.3.0 为虚拟手柄加入了宏录制与循环回放，也让首次安装和彻底清理环境的过程更直观。

- 录制屏幕手柄、键盘、鼠标按键和鼠标移动，并按原始节奏回放。
- 可设置回放次数，或无限循环直到手动停止。
- 操作宏面板后无需再点击手柄区域，键盘控制会自动恢复。
- 安装与卸载窗口实时显示当前步骤和命令输出，长时间操作不再像卡死。
- 操作失败时在 PowerShell 窗口中显示原因和日志位置，并等待确认后关闭。
- 分开显示“重启后继续安装”和“重启后完成清理”，不会在卸载后给出错误操作提示。
- 如果电脑原本没有 WSL，卸载时会一并移除由 SplatoonDeck 添加的 WSL 运行时和 Windows 功能；原有环境和其他发行版保持不变。

## English

v0.3.0 adds controller macro recording and looping playback, while making first-time setup and complete cleanup much easier to follow.

- Record the on-screen controller, keyboard, mouse buttons, and mouse movement, then replay them with their original timing.
- Choose a repeat count or loop continuously until stopped.
- Keyboard controller input resumes automatically after using the macro panel.
- Setup and cleanup windows now show live steps and command output, so long operations no longer appear frozen.
- When an operation fails, the PowerShell window shows the reason and log location and waits for confirmation before closing.
- Setup and cleanup restart states have separate messages and actions.
- On a PC that did not previously have WSL, cleanup also removes the WSL runtime and Windows features added by SplatoonDeck. Existing environments and other distributions remain untouched.

## 日本語

v0.3.0 では、コントローラー操作マクロの録画・ループ再生を追加し、初回セットアップと完全なクリーンアップも分かりやすくしました。

- 画面上のコントローラー、キーボード、マウスボタン、マウス移動を録画し、元のタイミングで再生できます。
- 再生回数の指定、または手動停止までの連続ループに対応しました。
- マクロ画面を操作した後も、キーボードによるコントローラー操作が自動で復帰します。
- セットアップと削除のウィンドウに手順とコマンド出力をリアルタイム表示します。
- 失敗時は PowerShell ウィンドウに原因とログ位置を表示し、確認するまで閉じません。
- インストール継続とクリーンアップ完了の再起動表示・操作を分けました。
- WSL がなかった PC では、SplatoonDeck が追加した WSL ランタイムと Windows 機能も削除します。既存環境や他のディストリビューションは変更しません。

### Verification

- 61 automated tests passed.
- Production build completed successfully.
- Portable EXE product version: `0.3.0`.
- SHA-256: `C774291CFEA46B802C54D2AA1A18D66CB8CC804034AF08C12AE7202C049A695A`
