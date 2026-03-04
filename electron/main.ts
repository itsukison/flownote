import 'dotenv/config'
import { app, BrowserWindow, ipcMain, screen, globalShortcut, session, desktopCapturer } from 'electron'
import * as path from 'path'
import { registerHandlers } from './ipc/handlers'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  const { workAreaSize } = screen.getPrimaryDisplay()

  mainWindow = new BrowserWindow({
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Float over full-screen apps on macOS
  if (process.platform === 'darwin') {
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  // Enable system audio loopback capture
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      if (sources && sources.length > 0) {
        callback({ video: sources[0], audio: 'loopback' })
      } else {
        callback({})
      }
    }).catch(() => callback({}))
  })

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5182')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function init() {
  app.setName('FlowNote')

  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }

  // Register IPC handlers (pass getter for mainWindow)
  registerHandlers(() => mainWindow)

  // Window close handler
  ipcMain.handle('quit-app', () => app.quit())

  app.whenReady().then(() => {
    createWindow()

    // Cmd+B: Toggle visibility
    globalShortcut.register('CommandOrControl+B', () => {
      if (!mainWindow) return
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (mainWindow === null) createWindow()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })

  if (process.platform === 'darwin') {
    app.dock?.hide()
  }
}

init().catch(console.error)
