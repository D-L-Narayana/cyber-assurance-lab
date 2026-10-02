import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/archivo';
import '@fontsource-variable/public-sans';
import './styles.css';
import { App } from './App';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
