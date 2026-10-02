import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/instrument-serif';
import '@fontsource-variable/figtree';
import '@fontsource-variable/red-hat-mono';
import './styles.css';
import { App } from './App';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
