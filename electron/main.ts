import 'dotenv/config'
import { app, BrowserWindow, ipcMain, screen, globalShortcut, session, desktopCapturer } from 'electron'
import * as path from 'path'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { registerHandlers } from './ipc/handlers'
import { registerAuthHandlers, registerAuthStateListener } from './ipc/auth'
import { registerDocumentHandlers } from './ipc/documents'

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let supabase: SupabaseClient | null = null

const DEV = process.env.NODE_ENV === 'development' || !app.isPackaged
const BASE_URL = 'http://localhost:5182'

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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
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
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    frame: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
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
  }
}

async function init() {
  app.setName('CueMe')

  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) { app.quit(); return }

  // Initialize Supabase
  const supabaseUrl = process.env.SUPABASE_URL || 'https://qysgsadrjijofvtzmziw.supabase.co'
  const supabaseKey = process.env.SUPABASE_ANON_KEY || ''

  if (supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey)
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
    await createMainWindow()
    createOverlayWindow()

    // Global shortcut: toggle overlay (only when logged in)
    globalShortcut.register('CommandOrControl+Shift+C', () => {
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
