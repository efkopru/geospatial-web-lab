import React from 'react';
import {createRoot} from 'react-dom/client';
import '@geo/shared/style.css';
import {configureStandalone} from '../../shared/runtime.js';
import * as adapter from './local-api.js';
import App from './App.jsx';
configureStandalone({id:'03-fleet-monitor',...adapter});
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
