import dotenv from 'dotenv'
import { app, BrowserWindow, ipcMain, screen, globalShortcut, session, desktopCapturer, protocol, Tray, Menu, nativeImage } from 'electron'
import * as path from 'path'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { registerHandlers } from './ipc/handlers'
import { registerAuthHandlers, registerAuthStateListener } from './ipc/auth'
import { registerDocumentHandlers } from './ipc/documents'
import { registerOrganizationHandlers } from './ipc/organization'
import { stopTranscriptionAndSave, getCurrentTranscriptIdValue } from './ipc/transcription-handlers'
import { getStoredSession } from './services/tokenStorage'
import { initUpdater, flushPendingUpdate } from './services/updater'
import { getCacheRoot } from './services/documentCache'
import { fetchUsageState } from './services/usageLimiter'

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let tray: Tray | null = null
let supabase: SupabaseClient | null = null
let supabaseConfigErrorMsg: string | null = null
let isQuitting = false

const DEV = process.env.NODE_ENV === 'development' || !app.isPackaged
const BASE_URL = 'http://localhost:5182'

dotenv.config()

// Register flownote:// as a custom protocol for deep linking (Stripe checkout callback)
if (!app.isDefaultProtocolClient('flownote')) {
  app.setAsDefaultProtocolClient('flownote')
}

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
  return DEV ? `${BASE_URL}/#${path}` : `file://${__dirname}/../dist/index.html#${path}`
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
    hasShadow: process.platform === 'darwin',
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

  overlayWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      overlayWindow?.hide()
    }
  })

  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
}

function createMainWindow() {
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

  mainWindow.loadURL(devUrl('/auth'))

  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow) flushPendingUpdate(mainWindow)
    if (supabaseConfigErrorMsg) {
      mainWindow?.webContents.send('toast:show', { type: 'error', message: supabaseConfigErrorMsg })
    }
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame) {
      console.error('[Main] did-fail-load:', { errorCode, errorDescription, validatedURL })
    }
  })

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
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

function createTray() {
  const iconPath = path.join(__dirname, '../public/tray-icon.png')
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Flownote')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Flownote',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Flownote',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)

  // Left-click also opens the main window
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

async function init() {
  app.setName('Flownote')

  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) { app.quit(); return }

  if (app.isPackaged) {
    dotenv.config({ path: path.join(process.resourcesPath, '.env'), override: true })
  }

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
    supabaseConfigErrorMsg = 'Supabaseの設定が見つかりませんでした。ビルド設定を確認してください。'
  }

  // Register all IPC handlers
  registerHandlers(getOverlayWindow, getMainWindow, () => supabase)
  registerAuthHandlers(getMainWindow, getOverlayWindow, () => supabase)
  registerDocumentHandlers(getMainWindow, getOverlayWindow, () => supabase)
  registerOrganizationHandlers(getMainWindow, getOverlayWindow, () => supabase)
  ipcMain.handle('quit-app', async () => {
    if (getCurrentTranscriptIdValue()) {
      await stopTranscriptionAndSave().catch((err) =>
        console.error('[Quit] stopTranscriptionAndSave error:', err)
      )
    }
    app.quit()
  })

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

    createMainWindow()
    createOverlayWindow()
    createTray()
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
    if (mainWindow === null) {
      createMainWindow()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.on('before-quit', () => {
    isQuitting = true
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })

  // Handle flownote:// deep links (e.g. flownote://subscription-updated)
  const handleDeepLink = async (url: string) => {
    console.log('[DeepLink] Received:', url)
    if (url.includes('subscription-updated') && supabase) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        // Re-fetch plan state from Supabase
        const state = await fetchUsageState(supabase, user.id)
        mainWindow?.webContents.send('plan:changed', { plan: state.plan, subscriptionStatus: state.subscriptionStatus })
        overlayWindow?.webContents.send('plan:changed', { plan: state.plan, subscriptionStatus: state.subscriptionStatus })
      }
      // Show and focus main window
      mainWindow?.show()
      mainWindow?.focus()
    }
  }

  // macOS: deep links arrive via open-url
  app.on('open-url', (_event, url) => {
    handleDeepLink(url)
  })

  // Windows/Linux: deep links arrive as second-instance args
  app.on('second-instance', (_event, argv) => {
    const deepLink = argv.find(arg => arg.startsWith('flownote://'))
    if (deepLink) handleDeepLink(deepLink)
    mainWindow?.show()
    mainWindow?.focus()
  })

  // Subscribe to profile changes via Supabase Realtime (for live plan updates)
  if (supabase) {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user && supabase) {
        supabase
          .channel('profile-plan-changes')
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'profiles',
              filter: `id=eq.${user.id}`,
            },
            async (payload) => {
              const newPlan = payload.new as any
              if (newPlan.plan || newPlan.subscription_status) {
                // Re-fetch full state
                const state = await fetchUsageState(supabase!, user.id)
                mainWindow?.webContents.send('plan:changed', { plan: state.plan, subscriptionStatus: state.subscriptionStatus })
                overlayWindow?.webContents.send('plan:changed', { plan: state.plan, subscriptionStatus: state.subscriptionStatus })
              }
            }
          )
          .subscribe()
      }
    })
  }

  if (process.platform === 'darwin') {
    app.dock?.hide()
  }
}

init().catch(console.error)
