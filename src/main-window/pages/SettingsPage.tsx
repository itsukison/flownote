import { useState, useEffect } from 'react'
import { User, Mic, Cpu, BarChart2, LogOut, Loader2 } from 'lucide-react'

interface Props {
    user: any
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            onClick={() => onChange(!on)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${on ? 'bg-blue-500' : 'bg-white/15'}`}
        >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
        </button>
    )
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium rounded-xl transition-all ${active ? 'bg-white/[0.08] text-white' : 'text-white/40 hover:text-white/60'
                }`}
        >
            <Icon size={13} />
            {label}
        </button>
    )
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between py-4 border-b border-white/[0.04]">
            <div>
                <p className="text-sm text-white/80">{label}</p>
                {description && <p className="text-xs text-white/35 mt-0.5">{description}</p>}
            </div>
            <div className="flex-none">{children}</div>
        </div>
    )
}

export default function SettingsPage({ user }: Props) {
    const [tab, setTab] = useState<'account' | 'audio' | 'ai' | 'usage'>('account')
    const [detection, setDetection] = useState({ gemini: true, regex: true })
    const [usage, setUsage] = useState<{ questions_count: number; documents_count: number; tokens_used: number } | null>(null)
    const [loadingUsage, setLoadingUsage] = useState(false)

    useEffect(() => {
        if (tab === 'usage') {
            setLoadingUsage(true)
            window.electronAPI?.getTokenUsage().then((u) => {
                setUsage(u)
                setLoadingUsage(false)
            })
        }
    }, [tab])

    const tabs = [
        { id: 'account' as const, icon: User, label: 'Account' },
        { id: 'audio' as const, icon: Mic, label: 'Detection' },
        { id: 'ai' as const, icon: Cpu, label: 'AI' },
        { id: 'usage' as const, icon: BarChart2, label: 'Usage' },
    ]

    return (
        <div className="max-w-2xl mx-auto px-8 py-8">
            <h1 className="text-lg font-semibold text-white mb-6">Settings</h1>

            {/* Tab bar */}
            <div className="flex gap-1 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-1.5 mb-8">
                {tabs.map((t) => (
                    <TabButton key={t.id} active={tab === t.id} onClick={() => setTab(t.id)} icon={t.icon} label={t.label} />
                ))}
            </div>

            {/* Account tab */}
            {tab === 'account' && (
                <div>
                    <SettingRow label="Email" description="Your account email address">
                        <span className="text-xs text-white/40 font-mono">{user?.email}</span>
                    </SettingRow>
                    <SettingRow label="Sign out" description="You'll need to sign in again to use FlowNote">
                        <button
                            onClick={() => window.electronAPI?.signOut()}
                            className="flex items-center gap-1.5 px-3 py-2 bg-red-500/10 hover:bg-red-500/15 border border-red-500/20 rounded-xl text-xs text-red-400 transition-all"
                        >
                            <LogOut size={12} />
                            Sign out
                        </button>
                    </SettingRow>
                </div>
            )}

            {/* Audio / Detection tab */}
            {tab === 'audio' && (
                <div>
                    <p className="text-xs text-white/30 mb-4">These settings sync with the overlay's detection panel.</p>
                    <SettingRow label="Gemini detection" description="AI understands context and informal phrasing">
                        <Toggle on={detection.gemini} onChange={(v) => {
                            setDetection((d) => ({ ...d, gemini: v }))
                            window.electronAPI?.setDetectionSettings(v, detection.regex)
                        }} />
                    </SettingRow>
                    <SettingRow label="Regex detection" description="Pattern matching for common question phrases in Japanese & English">
                        <Toggle on={detection.regex} onChange={(v) => {
                            setDetection((d) => ({ ...d, regex: v }))
                            window.electronAPI?.setDetectionSettings(detection.gemini, v)
                        }} />
                    </SettingRow>
                </div>
            )}

            {/* AI tab */}
            {tab === 'ai' && (
                <div>
                    <SettingRow label="Question detection model" description="Identifies questions from audio transcription">
                        <span className="text-xs text-white/30 bg-white/[0.06] px-2.5 py-1.5 rounded-lg">Gemini 2.0 Flash</span>
                    </SettingRow>
                    <SettingRow label="Answer generation model" description="Generates responses with optional RAG context">
                        <span className="text-xs text-white/30 bg-white/[0.06] px-2.5 py-1.5 rounded-lg">Gemini 2.0 Flash</span>
                    </SettingRow>
                    <SettingRow label="Embedding model" description="Converts documents to vectors for semantic search">
                        <span className="text-xs text-white/30 bg-white/[0.06] px-2.5 py-1.5 rounded-lg">OpenAI text-embedding-3-small</span>
                    </SettingRow>
                    <SettingRow label="Vector database" description="Stores and searches your document embeddings">
                        <span className="text-xs text-white/30 bg-white/[0.06] px-2.5 py-1.5 rounded-lg">Supabase pgvector</span>
                    </SettingRow>
                </div>
            )}

            {/* Usage tab */}
            {tab === 'usage' && (
                <div>
                    {loadingUsage ? (
                        <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-white/20" /></div>
                    ) : usage ? (
                        <>
                            <p className="text-xs text-white/30 mb-4">Usage for today</p>
                            <div className="grid grid-cols-3 gap-4">
                                {[
                                    { label: 'Questions', value: usage.questions_count.toString() },
                                    { label: 'Documents', value: usage.documents_count.toString() },
                                    { label: 'Tokens used', value: usage.tokens_used.toLocaleString() },
                                ].map(({ label, value }) => (
                                    <div key={label} className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4">
                                        <p className="text-2xl font-semibold text-white">{value}</p>
                                        <p className="text-xs text-white/35 mt-1">{label}</p>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <p className="text-sm text-white/30 text-center py-12">No usage data yet</p>
                    )}
                </div>
            )}
        </div>
    )
}
