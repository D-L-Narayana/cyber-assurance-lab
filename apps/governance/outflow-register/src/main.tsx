import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/newsreader';
import '@fontsource-variable/newsreader/wght-italic.css';
import '@fontsource-variable/hanken-grotesk';
import '@fontsource-variable/azeret-mono';
import './styles.css';
import { App } from './ui/App';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
