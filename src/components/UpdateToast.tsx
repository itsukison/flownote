import { useState, useEffect, useCallback, useRef } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface UpdateInfo {
  version: string
}

interface UpdateProgress {
  percent: number
  version?: string
}

type UpdateState =
  | { kind: 'idle' }
  | { kind: 'downloading'; info: UpdateInfo }
  | { kind: 'progress'; info: UpdateInfo; percent: number }
  | { kind: 'preparing'; info: UpdateInfo }
  | { kind: 'ready'; info: UpdateInfo }
  | { kind: 'error' }

// ── Main component ────────────────────────────────────────────────────────────

export function UpdateToast() {
  const [state, setState] = useState<UpdateState>({ kind: 'idle' })
  const [dismissed, setDismissed] = useState(false)
  // Track the latest version so progress events can reference it even if
  // update:available fires before this component has mounted
  const versionRef = useRef<string | null>(null)

  const handleAvailable = useCallback((info: UpdateInfo) => {
    versionRef.current = info.version
    setState({ kind: 'downloading', info })
    setDismissed(false)
  }, [])

  const handleProgress = useCallback((data: UpdateProgress) => {
    const version = data.version ?? versionRef.current ?? ''
    const syntheticInfo: UpdateInfo = { version }
    setState(prev => {
      const info =
        prev.kind !== 'idle' && prev.kind !== 'error'
          ? (prev as { info: UpdateInfo }).info
          : syntheticInfo
      if (data.percent >= 100) return { kind: 'preparing', info }
      return { kind: 'progress', info, percent: Math.floor(data.percent) }
    })
  }, [])

  const handleReady = useCallback((info: UpdateInfo) => {
    versionRef.current = info.version
    setState({ kind: 'ready', info })
    setDismissed(false)
  }, [])

  const handleError = useCallback((data: { message: string }) => {
    setState({ kind: 'error' })
    setDismissed(false)
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.update) return

    const cleanupAvailable = window.electronAPI.update.onAvailable(handleAvailable)
    const cleanupProgress = window.electronAPI.update.onProgress(handleProgress)
    const cleanupReady = window.electronAPI.update.onReady(handleReady)
    const cleanupError = window.electronAPI.update.onError(handleError)

    return () => {
      cleanupAvailable()
      cleanupProgress()
      cleanupReady()
      cleanupError()
    }
  }, [handleAvailable, handleProgress, handleReady, handleError])

  const handleInstall = useCallback(() => {
    window.electronAPI?.update?.install()
  }, [])

  const handleDismiss = useCallback(() => {
    setDismissed(true)
  }, [])

  if (state.kind === 'idle' || dismissed) return null

  return (
    <div
      className="fixed bottom-5 right-5 z-50 w-72 animate-in slide-in-from-bottom-2 duration-300"
      role="status"
      aria-live="polite"
    >
      <div className="bg-[#111113] border border-white/[0.08] rounded-xl p-4 shadow-2xl shadow-black/60">
        {state.kind === 'downloading' && (
          <DownloadingView version={state.info.version} percent={null} onDismiss={handleDismiss} />
        )}
        {state.kind === 'progress' && (
          <DownloadingView version={state.info.version} percent={state.percent} onDismiss={handleDismiss} />
        )}
        {state.kind === 'preparing' && (
          <PreparingView version={state.info.version} onDismiss={handleDismiss} />
        )}
        {state.kind === 'ready' && (
          <ReadyView version={state.info.version} onInstall={handleInstall} onDismiss={handleDismiss} />
        )}
        {state.kind === 'error' && (
          <ErrorView onDismiss={handleDismiss} />
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ToastHeader({ label }: { label: string }) {
  return (
    <p className="text-[10px] font-medium uppercase tracking-wider text-white/30 mb-2">
      {label}
    </p>
  )
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="mt-3 h-[2px] w-full rounded-full bg-white/10 overflow-hidden">
      <div
        className="h-full bg-white/40 rounded-full transition-all duration-300"
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

function DownloadingView({ version, percent, onDismiss }: {
  version: string
  percent: number | null
  onDismiss: () => void
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div>
          <ToastHeader label="アップデートあり" />
          <p className="text-sm font-medium text-white/80">v{version}</p>
          <p className="text-xs text-white/40 mt-0.5">
            {percent !== null ? `ダウンロード中… ${percent}%` : 'ダウンロード開始中…'}
          </p>
        </div>
        <DismissButton onClick={onDismiss} />
      </div>
      {percent !== null && <ProgressBar percent={percent} />}
    </>
  )
}

function PreparingView({ version, onDismiss }: {
  version: string
  onDismiss: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <ToastHeader label="アップデートあり" />
        <p className="text-sm font-medium text-white/80">v{version}</p>
        <p className="text-xs text-white/40 mt-0.5">準備中…</p>
      </div>
      <DismissButton onClick={onDismiss} />
    </div>
  )
}

function ReadyView({ version, onInstall, onDismiss }: {
  version: string
  onInstall: () => void
  onDismiss: () => void
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div>
          <ToastHeader label="アップデート完了" />
          <p className="text-sm font-medium text-white/80">v{version} の準備ができました</p>
          <p className="text-xs text-white/40 mt-0.5">再起動してアップデートを適用します</p>
        </div>
        <DismissButton onClick={onDismiss} />
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={onInstall}
          className="flex-1 h-8 rounded-lg bg-blue-500/80 hover:bg-blue-500 text-xs font-medium text-white transition-colors duration-150"
        >
          再起動してアップデート
        </button>
        <button
          onClick={onDismiss}
          className="h-8 px-3 rounded-lg text-xs font-medium text-white/30 hover:text-white/60 hover:bg-white/[0.05] transition-colors duration-150"
        >
          後で
        </button>
      </div>
    </>
  )
}

function ErrorView({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <ToastHeader label="アップデート失敗" />
        <p className="text-xs text-white/40 mt-0.5">
          アップデートの確認に失敗しました
        </p>
      </div>
      <DismissButton onClick={onDismiss} />
    </div>
  )
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="閉じる"
      className="shrink-0 w-5 h-5 flex items-center justify-center rounded-md text-white/25 hover:text-white/50 hover:bg-white/[0.05] transition-colors duration-150"
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  )
}
