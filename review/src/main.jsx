import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './style.css';

class Boundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return <main className="fatal"><h1>검수 화면을 표시하지 못했습니다.</h1><p>{this.state.error.message}</p><p>이미 저장한 기록은 서버에 남아 있습니다.</p><button onClick={() => location.reload()}>다시 열기</button></main>;
    return this.props.children;
  }
}
createRoot(document.getElementById('root')).render(<Boundary><App /></Boundary>);
