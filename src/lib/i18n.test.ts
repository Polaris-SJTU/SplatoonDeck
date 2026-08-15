import { describe, expect, it } from 'vitest';
import { translate, translateExternal } from './i18n';

describe('application localization', () => {
  it('translates primary navigation and interpolated status text', () => {
    expect(translate('en-US', '虚拟手柄')).toBe('Virtual Controller');
    expect(translate('ja-JP', '涂鸦工坊')).toBe('インクラボ');
    expect(translate('en-US', '环境就绪度 {{count}}/3 · v{{version}}', { count: 3, version: '0.2.1' }))
      .toBe('Environment 3/3 · v0.2.1');
  });

  it('keeps Simplified Chinese as the source-language fallback', () => {
    expect(translate('zh-CN', '准备舱')).toBe('准备舱');
    expect(translate('en-US', 'arbitrary file name.png')).toBe('arbitrary file name.png');
  });

  it('localizes structured diagnostics and common backend errors', () => {
    expect(translateExternal('en-US', '诊断完成：2 项需要处理')).toBe('Diagnostics complete: 2 item(s) need attention');
    expect(translateExternal('ja-JP', 'NXBT 加载失败：module missing')).toBe('NXBT の読み込みに失敗しました: module missing');
    expect(translateExternal('en-US', '缺少安装脚本：C:\\setup.ps1')).toBe('Missing installation script: C:\\setup.ps1');
    expect(translateExternal('ja-JP', '蓝牙设备 Bus ID 无效')).toBe('Bluetooth デバイスの Bus ID が無効です');
  });

  it('fully localizes macro recording and repeat playback controls', () => {
    const macroKeys = [
      '宏录制与回放', '记录按键、摇杆和操作间隔，之后按原始节奏重新执行。',
      '录制中', '回放中', '已录制', '尚未录制宏', '持续时间', '事件', '保存位置', '仅保存在本机',
      '事件时间线', '按下', '松开', '录制会捕获屏幕手柄、键盘、鼠标按键和鼠标移动。',
      '回放方式', '指定次数', '回放次数', '次', '无限循环', '第 {{round}} 轮',
      '第 {{round}} 轮 · 无限循环', '第 {{round}} / {{total}} 轮', '开始录制', '停止录制',
      '回放', '停止回放', '正在启动回放…', '清空', '宏回放进行中',
      '正在按录制节奏执行，手柄输入已锁定', '宏回放完成', '宏回放已停止',
      '宏回放启动失败', '宏回放停止失败', '录制已保存', '录制内容已清空',
      '没有记录到手柄操作', '没有可回放的录制内容', '已有宏任务正在运行'
    ];
    for (const locale of ['en-US', 'ja-JP'] as const) {
      for (const key of macroKeys) expect(translate(locale, key), `${locale}: ${key}`).not.toBe(key);
    }
    expect(translate('en-US', '宏录制与回放')).toBe('Macro Recording & Playback');
    expect(translate('ja-JP', '无限循环')).toBe('停止まで繰り返す');
    expect(translate('en-US', '第 {{round}} / {{total}} 轮', { round: 2, total: 5 })).toBe('Round 2 / 5');
    expect(translateExternal('ja-JP', '已有宏任务正在运行')).toBe('別のマクロを実行中です');
  });
});
