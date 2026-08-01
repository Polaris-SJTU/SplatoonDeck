import React from 'react';
import ReactDOM from 'react-dom/client';
import './mock-bridge';
import App from './App';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

if (!window.squidSketch) {
  root.render(
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#101014', color: '#f4f4f6', fontFamily: 'system-ui' }}>
      <div style={{ maxWidth: 520, padding: 32 }}>
        <h1>SquidDeck 启动失败</h1>
        <p style={{ color: '#aaa9b2', lineHeight: 1.7 }}>安全桥接模块没有加载。请关闭应用后重新打开；如果仍然出现此页面，请重新下载完整的 EXE 文件。</p>
      </div>
    </div>
  );
} else {
  root.render(<React.StrictMode><App /></React.StrictMode>);
}
