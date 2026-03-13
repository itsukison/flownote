import 'dotenv/config'
import { app, BrowserWindow, ipcMain, screen, globalShortcut, session, desktopCapturer, protocol } from 'electron'
import * as path from 'path'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { registerHandlers } from './ipc/handlers'
import { registerAuthHandlers, registerAuthStateListener } from './ipc/auth'
import { registerDocumentHandlers } from './ipc/documents'
import { getStoredSession } from './services/tokenStorage'
import { initUpdater, flushPendingUpdate } from './services/updater'
import { getCacheRoot } from './services/documentCache'

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let supabase: SupabaseClient | null = null

const DEV = process.env.NODE_ENV === 'development' || !app.isPackaged
const BASE_URL = 'http://localhost:5182'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'flownote-file',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

function devUrl(path: string) {
  return DEV ? `${BASE_URL}${path}` : `file://${__dirname}/../dist/index.html#${path}`
}

function createOverlayWindow() {
  const { workAreaSize } = screen.getPrimaryDisplay()

  overlayWindow = new BrowserWindow({
    width: 380,
    height: 520,
    x: workAreaSize.width - 400,
    y: 40,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    hasShadow: true,
    skipTaskbar: true,
    show: false,
    fullscreenable: false,
    icon: path.join(__dirname, '../public/app-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#00000000',
  })

  if (process.platform === 'darwin') {
    overlayWindow.setAlwaysOnTop(true, 'screen-saver')
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      if (sources && sources.length > 0) {
        callback({ video: sources[0], audio: 'loopback' })
      } else {
        callback({})
      }
    }).catch(() => callback({}))
  })

  overlayWindow.loadURL(devUrl('/overlay'))

  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
}

async function createMainWindow() {
  const { workAreaSize } = screen.getPrimaryDisplay()

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    x: Math.round((workAreaSize.width - 1000) / 2),
    y: Math.round((workAreaSize.height - 700) / 2),
    minWidth: 800,
    minHeight: 600,
    frame: true,
    icon: path.join(__dirname, '../public/app-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#0e0e10',
  })

  // Check session to decide landing page
  let startPath = '/auth'
  if (supabase) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) startPath = '/documents'
    } catch { }
  }

  mainWindow.loadURL(devUrl(startPath))

  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow) flushPendingUpdate(mainWindow)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}

function getOverlayWindow() { return overlayWindow }
function getMainWindow() { return mainWindow }

function toggleOverlay() {
  if (!overlayWindow) return
  if (overlayWindow.isVisible()) {
    overlayWindow.hide()
  } else {
    overlayWindow.show()
    overlayWindow.focus()
    if (mainWindow?.isFullScreen()) {
      mainWindow.setFullScreen(false)
    }
  }
}

function toggleMainWindow() {
  if (!mainWindow) return
  if (mainWindow.isVisible()) {
    mainWindow.hide()
  } else {
    mainWindow.show()
    mainWindow.focus()
  }
}

async function init() {
  app.setName('Flownote')

  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) { app.quit(); return }

  // Initialize Supabase
  const supabaseUrl = process.env.SUPABASE_URL || 'https://qysgsadrjijofvtzmziw.supabase.co'
  const supabaseKey = process.env.SUPABASE_ANON_KEY || ''

  if (supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey)

    const storedSession = getStoredSession()
    if (storedSession?.refresh_token) {
      const { error } = await supabase.auth.setSession({
        access_token: storedSession.access_token,
        refresh_token: storedSession.refresh_token,
      })
      if (error) {
        console.log('[Auth] Stored session invalid or expired:', error.message)
      } else {
        console.log('[Auth] Session restored from storage')
      }
    }
  } else {
    console.warn('[Main] SUPABASE_ANON_KEY not set')
  }

  // Register all IPC handlers
  registerHandlers(getOverlayWindow, getMainWindow, () => supabase)
  registerAuthHandlers(getMainWindow, getOverlayWindow, () => supabase)
  registerDocumentHandlers(getMainWindow, () => supabase)
  ipcMain.handle('quit-app', () => app.quit())

  // Register auth state listener after supabase is ready
  if (supabase) {
    registerAuthStateListener(supabase, getMainWindow, getOverlayWindow)
  }

  app.whenReady().then(async () => {
    protocol.registerFileProtocol('flownote-file', (request, callback) => {
      try {
        const url = new URL(request.url)
        let decodedPath = decodeURIComponent(url.pathname)
        if (decodedPath.startsWith('//')) {
          decodedPath = decodedPath.slice(1)
        }

        const cacheRoot = path.normalize(getCacheRoot()) + path.sep
        const normalized = path.normalize(decodedPath)

        if (!normalized.startsWith(cacheRoot)) {
          callback({ error: -6 })
          return
        }

        callback({ path: normalized })
      } catch (err) {
        console.error('[Protocol] flownote-file error:', err)
        callback({ error: -2 })
      }
    })

    await createMainWindow()
    createOverlayWindow()
    mainWindow?.show()
    mainWindow?.focus()

    // Initialize auto-updater (packaged builds only)
    if (app.isPackaged) initUpdater(getMainWindow)

    // Global shortcut: toggle overlay (only when logged in)
    globalShortcut.register('CommandOrControl+/', () => {
      if (!supabase) {
        mainWindow?.webContents.send('toast:show', { type: 'error', message: 'Supabase not configured' })
        return
      }
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          toggleOverlay()
        } else {
          mainWindow?.webContents.send('toast:show', { type: 'info', message: 'Please log in first to use the overlay' })
          mainWindow?.show()
          mainWindow?.focus()
        }
      })
    })

    // Global shortcut: toggle main window
    globalShortcut.register('CommandOrControl+Shift+/', () => {
      toggleMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (mainWindow === null) createMainWindow()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })

  if (process.platform === 'darwin') {
    app.dock?.hide()
  }
}

init().catch(console.error)
