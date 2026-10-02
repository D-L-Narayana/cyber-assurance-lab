import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/literata';
import '@fontsource-variable/martian-mono';
import './styles.css';
import { App } from './ui/App';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
