import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

// Ensure global is available on window for browser-compatible WebRTC libraries
if (typeof window !== 'undefined') {
  window.global = window;
}

createRoot(document.getElementById('root')).render(<App />);
