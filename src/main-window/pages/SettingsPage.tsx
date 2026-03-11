import { useState, useEffect } from 'react'
import { LogOut, Loader2, RotateCcw } from 'lucide-react'
import { ja } from '@/i18n/ja'

const t = ja

interface Props {
    user: any
}

export default function SettingsPage({ user }: Props) {
    const [usage, setUsage] = useState<{ questions_count: number; documents_count: number; tokens_used: number } | null>(null)
    const [loadingUsage, setLoadingUsage] = useState(true)
    const [audioPermStatus, setAudioPermStatus] = useState<'granted' | 'denied' | 'not-determined' | 'unknown' | null>(null)

    useEffect(() => {
        window.electronAPI?.checkSystemAudioPermission().then(setAudioPermStatus)
    }, [])

    useEffect(() => {
        setLoadingUsage(true)
        window.electronAPI?.getTokenUsage().then((u) => {
            setUsage(u)
            setLoadingUsage(false)
        })
    }, [])

    return (
        <div className="max-w-2xl mx-auto px-8 py-8">
            <h1 className="text-lg font-semibold text-zinc-100 mb-8">{t.settings.title}</h1>

            {/* Permissions Section */}
            <section className="space-y-1 mb-10">
                <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4">{t.permissions.title}</h2>
                <div className="flex justify-between items-center py-3 hover:bg-zinc-900/20 -mx-3 px-3 rounded-md transition-colors">
                    <div>
                        <p className="text-sm text-zinc-300">{t.permissions.systemAudio}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">{t.permissions.systemAudioHint}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {audioPermStatus !== null && (
                            <div className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${audioPermStatus === 'granted' ? 'bg-white/60' : 'bg-zinc-600'}`} />
                                <span className="text-xs text-zinc-500">
                                    {audioPermStatus === 'granted' ? t.permissions.granted : t.permissions.notGranted}
                                </span>
                            </div>
                        )}
                        <button
                            onClick={() => window.electronAPI?.checkSystemAudioPermission().then(setAudioPermStatus)}
                            className="p-1.5 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-600 hover:text-zinc-400"
                            title={t.permissions.checkAgain}
                        >
                            <RotateCcw size={12} />
                        </button>
                        <button
                            onClick={() => window.electronAPI?.openSystemAudioSettings()}
                            className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-xs text-zinc-500 transition-all"
                        >
                            {t.permissions.openSettings}
                        </button>
                    </div>
                </div>
            </section>

            {/* Account Section */}
            <section className="space-y-1 mb-10">
                <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4">{t.settings.account}</h2>
                <div className="flex justify-between items-center py-3 hover:bg-zinc-900/20 -mx-3 px-3 rounded-md transition-colors">
                    <div>
                        <p className="text-sm text-zinc-300">{t.settings.email}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">{t.settings.accountEmail}</p>
                    </div>
                    <span className="text-xs text-zinc-400 font-mono">{user?.email}</span>
                </div>
                <button
    onClick={() => window.electronAPI?.signOut()}
    // 1. Added text-left to ensure text doesn't center
    // 2. Kept justify-between so the icon stays on the far right
    className="w-full flex justify-between items-center py-3 hover:bg-zinc-900/20 -mx-3 px-3 rounded-md transition-colors text-left"
>
    <div>
        <p className="text-sm text-zinc-300">{t.settings.signOut}</p>
        <p className="text-xs text-zinc-500 mt-0.5">{t.settings.signOutHint}</p>
    </div>
    <LogOut size={16} className="text-zinc-500" />
</button>
            </section>

            {/* Usage Section */}
            <section className="space-y-1">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t.settings.usage}</h2>
                    <span className="text-xs text-zinc-600">{t.settings.today}</span>
                </div>
                {loadingUsage ? (
                    <div className="flex justify-center py-8">
                        <Loader2 size={20} className="animate-spin text-zinc-600" />
                    </div>
                ) : usage ? (
                    <div className="space-y-1">
                        <div className="flex justify-between items-center py-3 hover:bg-zinc-900/20 -mx-3 px-3 rounded-md transition-colors">
                            <span className="text-sm text-zinc-400">{t.settings.questions}</span>
                            <span className="text-sm text-zinc-300">{usage.questions_count}</span>
                        </div>
                        <div className="flex justify-between items-center py-3 hover:bg-zinc-900/20 -mx-3 px-3 rounded-md transition-colors">
                            <span className="text-sm text-zinc-400">{t.settings.documents}</span>
                            <span className="text-sm text-zinc-300">{usage.documents_count}</span>
                        </div>
                        <div className="flex justify-between items-center py-3 hover:bg-zinc-900/20 -mx-3 px-3 rounded-md transition-colors">
                            <span className="text-sm text-zinc-400">{t.settings.tokensUsed}</span>
                            <span className="text-sm text-zinc-300">{usage.tokens_used.toLocaleString()}</span>
                        </div>
                    </div>
                ) : (
                    <p className="text-sm text-zinc-500 text-center py-8">{t.settings.noUsageDataYet}</p>
                )}
            </section>
        </div>
    )
}
