import { useState, useEffect } from 'react'
import { LogOut, Loader2 } from 'lucide-react'

interface Props {
    user: any
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            onClick={() => onChange(!on)}
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${on ? 'bg-zinc-600' : 'bg-zinc-800'}`}
        >
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </button>
    )
}

export default function SettingsPage({ user }: Props) {
    const [detection, setDetection] = useState({ gemini: true, regex: true })
    const [usage, setUsage] = useState<{ questions_count: number; documents_count: number; tokens_used: number } | null>(null)
    const [loadingUsage, setLoadingUsage] = useState(true)

    useEffect(() => {
        setLoadingUsage(true)
        window.electronAPI?.getTokenUsage().then((u) => {
            setUsage(u)
            setLoadingUsage(false)
        })
    }, [])

    return (
        <div className="max-w-2xl mx-auto px-8 py-8">
            <h1 className="text-lg font-semibold text-zinc-100 mb-8">Settings</h1>

            {/* Account Section */}
            <section className="space-y-1 mb-10">
                <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4">Account</h2>
                <div className="flex justify-between items-center py-3 hover:bg-zinc-900/20 -mx-3 px-3 rounded-md transition-colors">
                    <div>
                        <p className="text-sm text-zinc-300">Email</p>
                        <p className="text-xs text-zinc-500 mt-0.5">Your account email address</p>
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
        <p className="text-sm text-zinc-300">Sign out</p>
        <p className="text-xs text-zinc-500 mt-0.5">You'll need to sign in again to use FlowNote</p>
    </div>
    <LogOut size={16} className="text-zinc-500" />
</button>
            </section>

            {/* Detection Section */}
            <section className="space-y-1 mb-10">
                <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4">Detection</h2>
                <div className="flex justify-between items-center py-3 hover:bg-zinc-900/20 -mx-3 px-3 rounded-md transition-colors">
                    <div>
                        <p className="text-sm text-zinc-300">Gemini detection</p>
                        <p className="text-xs text-zinc-500 mt-0.5">AI understands context and informal phrasing</p>
                    </div>
                    <Toggle 
                        on={detection.gemini} 
                        onChange={(v) => {
                            setDetection((d) => ({ ...d, gemini: v }))
                            window.electronAPI?.setDetectionSettings(v, detection.regex)
                        }} 
                    />
                </div>
                <div className="flex justify-between items-center py-3 hover:bg-zinc-900/20 -mx-3 px-3 rounded-md transition-colors">
                    <div>
                        <p className="text-sm text-zinc-300">Regex detection</p>
                        <p className="text-xs text-zinc-500 mt-0.5">Pattern matching for Japanese & English</p>
                    </div>
                    <Toggle 
                        on={detection.regex} 
                        onChange={(v) => {
                            setDetection((d) => ({ ...d, regex: v }))
                            window.electronAPI?.setDetectionSettings(detection.gemini, v)
                        }} 
                    />
                </div>
            </section>

            {/* Usage Section */}
            <section className="space-y-1">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Usage</h2>
                    <span className="text-xs text-zinc-600">Today</span>
                </div>
                {loadingUsage ? (
                    <div className="flex justify-center py-8">
                        <Loader2 size={20} className="animate-spin text-zinc-600" />
                    </div>
                ) : usage ? (
                    <div className="space-y-1">
                        <div className="flex justify-between items-center py-3 hover:bg-zinc-900/20 -mx-3 px-3 rounded-md transition-colors">
                            <span className="text-sm text-zinc-400">Questions</span>
                            <span className="text-sm text-zinc-300">{usage.questions_count}</span>
                        </div>
                        <div className="flex justify-between items-center py-3 hover:bg-zinc-900/20 -mx-3 px-3 rounded-md transition-colors">
                            <span className="text-sm text-zinc-400">Documents</span>
                            <span className="text-sm text-zinc-300">{usage.documents_count}</span>
                        </div>
                        <div className="flex justify-between items-center py-3 hover:bg-zinc-900/20 -mx-3 px-3 rounded-md transition-colors">
                            <span className="text-sm text-zinc-400">Tokens used</span>
                            <span className="text-sm text-zinc-300">{usage.tokens_used.toLocaleString()}</span>
                        </div>
                    </div>
                ) : (
                    <p className="text-sm text-zinc-500 text-center py-8">No usage data yet</p>
                )}
            </section>
        </div>
    )
}
