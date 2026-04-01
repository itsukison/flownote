import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater'
import { BrowserWindow } from 'electron'

// Deferred state — held until a mainWindow is ready to receive the event
let pendingAvailableInfo: UpdateInfo | null = null
let pendingReadyInfo: UpdateInfo | null = null
let pendingError: { message: string } | null = null

// Version carried from update-available so progress events always include it
let availableVersion: string | null = null

type GetWindowFn = () => BrowserWindow | null

let beforeQuitAndInstall: (() => void) | undefined

/**
 * Set up electron-updater. Call once from app.whenReady() (only when app.isPackaged).
 * Uses a 5-second delay so all IPC handlers and windows are initialised first.
 * Also works when no mainWindow exists at startup (overlay-only mode).
 *
 * @param onBeforeQuitAndInstall — e.g. set `isQuitting` so BrowserWindow `close` handlers
 *   do not call preventDefault+hide, which would block a clean quit/relaunch.
 */
export function initUpdater(getMainWindow: GetWindowFn, onBeforeQuitAndInstall?: () => void) {
  beforeQuitAndInstall = onBeforeQuitAndInstall

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.autoRunAppAfterInstall = true

  // Helper: send to mainWindow only when it exists and is live
  const send = (channel: string, data?: unknown) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  }

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    availableVersion = info.version
    pendingAvailableInfo = info
    pendingReadyInfo = null   // clear stale ready state from a previous cycle
    pendingError = null
    console.log(`[Updater] Update available: v${info.version}`)
    send('update:available', info)
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    send('update:progress', { percent: progress.percent, version: availableVersion })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    pendingReadyInfo = info
    pendingError = null
    console.log(`[Updater] Update downloaded: v${info.version}`)
    send('update:ready', info)
  })

  autoUpdater.on('error', (err: Error) => {
    const msg = err.message ?? ''
    const isNoReleasesYet =
      msg.includes('Cannot parse releases feed') ||
      msg.includes('Unable to find latest version') ||
      msg.includes('HttpError: 404')
    if (isNoReleasesYet) {
      console.log('[Updater] No releases found (expected on fresh install)')
      return
    }
    console.error('[Updater] Error:', msg)
    pendingError = { message: msg }
    send('update:error', { message: msg })
  })

  // Delay first check — avoids firing before any renderer is ready
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err: Error) => {
      console.error('[Updater] Check failed:', err.message)
    })
  }, 5000)

  // Periodic check for long-running sessions (every 4 hours)
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err: Error) => {
      console.error('[Updater] Periodic check failed:', err.message)
    })
  }, 4 * 60 * 60 * 1000)
}

/**
 * Replay any pending update state to a newly-loaded mainWindow.
 * Call this inside a `did-finish-load` handler every time a new mainWindow is created.
 */
export function flushPendingUpdate(win: BrowserWindow) {
  if (!win || win.isDestroyed()) return

  if (pendingReadyInfo) {
    win.webContents.send('update:ready', pendingReadyInfo)
  } else if (pendingAvailableInfo) {
    win.webContents.send('update:available', pendingAvailableInfo)
  } else if (pendingError) {
    win.webContents.send('update:error', pendingError)
  }
}

/**
 * Trigger install immediately (called from the IPC handler).
 * Defers quit so the `invoke` promise can settle and Squirrel / NSIS can run a normal quit sequence.
 */
export function installUpdate() {
  beforeQuitAndInstall?.()
  setImmediate(() => {
    autoUpdater.quitAndInstall(false, true)
  })
}
