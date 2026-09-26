import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './components/inventory/inventory.css';
import './reference-theme.css';
import './contrast-audit.css';
import './themes/light-theme.css';
import './theme-overrides.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
