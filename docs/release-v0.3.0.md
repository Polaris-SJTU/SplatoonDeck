## 中文

v0.3.0 为虚拟手柄加入了宏录制与循环回放，也让首次安装和彻底清理环境的过程更直观。

- 录制屏幕手柄、键盘、鼠标按键和鼠标移动，并按原始节奏回放。
- 可设置回放次数，或无限循环直到手动停止。
- 操作宏面板后无需再点击手柄区域，键盘控制会自动恢复。
- 安装与卸载窗口实时显示当前步骤和命令输出，长时间操作不再像卡死。
- 操作失败时在安装辅助窗口中显示原因和日志位置，并等待确认后关闭。
- Windows 侧环境管理改为随应用内置的原生辅助程序，不再依赖用户电脑中的 PowerShell 版本或默认终端。
- 启动与普通刷新不再调用 WSL；只有安装、主动诊断或使用相关功能时才会启动 WSL。
- 兼容需要更新的旧版 WSL：发行版检测不再启动 WSL，命令均有超时，安装会尝试自动更新，卸载也不会再卡在发行版列表检查。
- 安装改为可恢复的分阶段流程：准备 WSL 与 Windows 功能后停止并等待重启，重启后再启动 WSL 和导入专用环境。
- 专用 Linux 环境创建后能够可靠完成首次启动，修复在 WSL 已列出环境时仍误报“找不到发行版”的问题。
- 安装与卸载加入单实例保护；关闭进度窗口会终止其子进程，避免遗留 DISM 或重复安装相互阻塞。
- Ubuntu 环境下载支持断点续传、四次自动重试与官方 SHA-256 校验。
- 分开显示“重启后继续安装”和“重启后完成清理”，不会在卸载后给出错误操作提示。
- 如果电脑原本没有 WSL，卸载时会一并移除由 SplatoonDeck 添加的 WSL 运行时和 Windows 功能；原有环境和其他发行版保持不变。

## English

v0.3.0 adds controller macro recording and looping playback, while making first-time setup and complete cleanup much easier to follow.

- Record the on-screen controller, keyboard, mouse buttons, and mouse movement, then replay them with their original timing.
- Choose a repeat count or loop continuously until stopped.
- Keyboard controller input resumes automatically after using the macro panel.
- Setup and cleanup windows now show live steps and command output, so long operations no longer appear frozen.
- When an operation fails, the setup helper window shows the reason and log location and waits for confirmation before closing.
- Windows-side environment management now uses a bundled native helper and no longer depends on the user's PowerShell version or default terminal.
- Launching or refreshing the app no longer starts WSL; WSL runs only during setup, an explicit diagnostic, or a related controller action.
- Outdated WSL installations are handled safely: distribution detection no longer launches WSL, commands have timeouts, setup attempts an automatic update, and cleanup no longer stalls while listing distributions.
- Setup now uses resumable stages: it prepares WSL and Windows features, stops for the required restart, and only then starts WSL and imports the dedicated environment.
- The dedicated Linux environment now starts reliably after creation, fixing a case where WSL listed it but setup still reported that the distribution could not be found.
- Setup and cleanup are single-instance operations, and closing the progress window terminates their child processes to prevent orphaned DISM tasks or overlapping runs.
- Ubuntu environment downloads support resume, four automatic retries, and official SHA-256 verification.
- Setup and cleanup restart states have separate messages and actions.
- On a PC that did not previously have WSL, cleanup also removes the WSL runtime and Windows features added by SplatoonDeck. Existing environments and other distributions remain untouched.

## 日本語

v0.3.0 では、コントローラー操作マクロの録画・ループ再生を追加し、初回セットアップと完全なクリーンアップも分かりやすくしました。

- 画面上のコントローラー、キーボード、マウスボタン、マウス移動を録画し、元のタイミングで再生できます。
- 再生回数の指定、または手動停止までの連続ループに対応しました。
- マクロ画面を操作した後も、キーボードによるコントローラー操作が自動で復帰します。
- セットアップと削除のウィンドウに手順とコマンド出力をリアルタイム表示します。
- 失敗時はセットアップ補助ウィンドウに原因とログ位置を表示し、確認するまで閉じません。
- Windows 側の環境管理はアプリ内蔵のネイティブ補助プログラムへ移行し、PowerShell のバージョンや既定ターミナルに依存しません。
- アプリの起動や通常の更新では WSL を開始せず、セットアップ、手動診断、関連操作を行った場合のみ起動します。
- 更新が必要な旧版 WSL に対応しました。ディストリビューション確認では WSL を起動せず、各コマンドにタイムアウトを設け、セットアップ時は自動更新を試行し、削除時も一覧確認で停止しません。
- セットアップを再開可能な段階式フローへ変更しました。WSL と Windows 機能を準備した後は再起動待ちで停止し、再起動後にのみ WSL を開始して専用環境を取り込みます。
- 専用 Linux 環境の作成後に初回起動を確実に行えるようになり、WSL の一覧に表示されていても「ディストリビューションが見つからない」と誤判定する問題を修正しました。
- セットアップと削除に単一実行の保護を追加し、進捗ウィンドウを閉じると子プロセスも終了するため、DISM の残留や重複実行を防ぎます。
- Ubuntu 環境のダウンロードは再開、4 回の自動再試行、公式 SHA-256 検証に対応しました。
- インストール継続とクリーンアップ完了の再起動表示・操作を分けました。
- WSL がなかった PC では、SplatoonDeck が追加した WSL ランタイムと Windows 機能も削除します。既存環境や他のディストリビューションは変更しません。

### Verification

- 71 automated tests passed, including a compiled native-helper process test, staged-setup checks, resumable-download checks, and retired-name scan.
- Production build completed successfully.
- Portable EXE product version: `0.3.0`.
- A full first-time setup completed on a Windows environment that did not previously have WSL, including BlueZ, Python, NXBT, and final verification.
- SHA-256: `C3ACD3F7D165058E1D20C83AE3E74B89334F4FD773B71318FC9BB9FCF74C6F0C`
