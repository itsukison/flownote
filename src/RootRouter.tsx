import { useEffect } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import OverlayApp from './overlay/OverlayApp'
import MainApp from './main-window/MainApp'

/**
 * RootRouter decides which "app" to show.
 * - /overlay  → floating overlay with mic + question detection
 * - everything else → main window (auth + dashboard)
 *
 * The Electron main process loads the appropriate path:
 *   overlayWindow.loadURL('http://localhost:5182/overlay')
 *   mainWindow.loadURL('http://localhost:5182/auth') or '/documents'
 */
export default function RootRouter() {
    const location = useLocation()
    const navigate = useNavigate()

    // When running outside Electron (browser preview), default to main app
    useEffect(() => {
        if (location.pathname === '/' && !window.electronAPI) {
            navigate('/auth')
        }
    }, [])

    if (location.pathname.startsWith('/overlay')) {
        return <OverlayApp />
    }

    return <MainApp />
}
