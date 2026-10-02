import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/instrument-serif';
import '@fontsource-variable/public-sans';
import '@fontsource-variable/geist-mono';
import './styles.css';
import { App } from './ui/App';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
