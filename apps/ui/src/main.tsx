import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, getStoredTheme } from './theme';
import './styles.css';

const forced = new URLSearchParams(window.location.search).get('theme');
applyTheme(forced === 'dark' || forced === 'light' ? forced : getStoredTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
