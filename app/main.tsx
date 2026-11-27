import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LlmAvailabilityProvider } from './hooks/llmAvailability';
import './styles.css';
import './raw.css';
import './b04.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LlmAvailabilityProvider>
      <App />
    </LlmAvailabilityProvider>
  </React.StrictMode>,
);
