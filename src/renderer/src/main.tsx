import React from 'react'
import { createRoot } from 'react-dom/client'
import { AppRoot } from './app/app-root'
import './styles.css'

const rootElement = document.getElementById('root')
if (rootElement) createRoot(rootElement).render(<AppRoot />)
