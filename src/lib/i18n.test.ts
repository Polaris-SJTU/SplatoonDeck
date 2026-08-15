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
});
