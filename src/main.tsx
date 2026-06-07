import { StrictMode, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

/**
 * 최후의 안전망 — 렌더 중 예외가 나도 흰 화면 대신 복구 UI를 보여준다.
 * (데이터는 보존되며, 새로고침으로 복귀 가능. 동기화 수정으로 소실은 별도 차단됨.)
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: unknown) { console.error('[ErrorBoundary]', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#f7f8fc', fontFamily: 'Inter, system-ui, sans-serif' }}>
          <div style={{ maxWidth: 420, textAlign: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 24, boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🏐</div>
            <h1 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: '0 0 8px' }}>화면을 그리는 중 문제가 발생했습니다</h1>
            <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px', lineHeight: 1.5 }}>
              데이터는 안전합니다. 새로고침하면 정상으로 돌아옵니다.
            </p>
            <button
              onClick={() => { this.setState({ error: null }); location.reload(); }}
              style={{ background: '#2563eb', color: '#fff', border: 0, borderRadius: 10, padding: '10px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
            >
              새로고침
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
