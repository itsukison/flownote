import { useState, useEffect } from 'react'
import { LogOut, Loader2 } from 'lucide-react'
import { ja } from '@/i18n/ja'

const t = ja

const JPY_RATE = 150
const COST_PER_MILLION = 0.10 // $0.10 per 1M normalized tokens

function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
    return n.toLocaleString()
}

interface Props {
    user: any
}

export default function SettingsPage({ user }: Props) {
    const [monthlyUsage, setMonthlyUsage] = useState<MonthlyUsage | null>(null)
    const [loadingUsage, setLoadingUsage] = useState(true)

    useEffect(() => {
        setLoadingUsage(true)
        window.electronAPI?.getMonthlyUsage().then((u) => {
            setMonthlyUsage(u)
            setLoadingUsage(false)
        })
    }, [])

    const usagePercent = monthlyUsage && monthlyUsage.token_limit > 0
        ? Math.min(100, (monthlyUsage.normalized_tokens / monthlyUsage.token_limit) * 100)
        : 0

    return (
        <div className="max-w-2xl mx-auto px-8 py-8">
            <h1 className="text-lg font-semibold text-zinc-100 mb-8">{t.settings.title}</h1>

            {/* Permissions Section */}
            <section className="space-y-1 mb-10">
                <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4">{t.permissions.title}</h2>
                <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-2xl p-5 space-y-4">
                    <div className="flex gap-4">
                        <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center shrink-0 border border-zinc-700 text-xs font-bold text-zinc-400">1</div>
                        <div>
                            <p className="text-sm font-medium text-zinc-200">{t.permissions.openSettings}</p>
                            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                                {t.permissions.systemAudioHint}
                            </p>
                            <button
                                onClick={() => window.electronAPI?.openSystemAudioSettings()}
                                className="mt-3 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-all flex items-center gap-2 group"
                            >
                                {t.permissions.openSettings}
                                <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                            </button>
                        </div>
                    </div>

                    <div className="h-px bg-zinc-800/50 ml-12" />

                    <div className="flex gap-4">
                        <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center shrink-0 border border-zinc-700 text-xs font-bold text-zinc-400">2</div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-zinc-200">{t.permissions.systemAudio}</p>
                            <div className="mt-2.5 p-3 bg-zinc-950/50 border border-zinc-800 rounded-xl space-y-2">
                                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
                                    {t.permissions.systemAudioPath.split(' → ').map((step, i, arr) => (
                                        <div key={step} className="flex items-center gap-2 shrink-0">
                                            <span className="px-2 py-1 bg-zinc-800/80 rounded border border-zinc-700/50 text-[10px] text-zinc-400 font-medium whitespace-nowrap">
                                                {step}
                                            </span>
                                            {i < arr.length - 1 && <span className="text-zinc-600">›</span>}
                                        </div>
                                    ))}
                                </div>
                                <p className="text-[11px] text-amber-500/80 leading-relaxed font-medium">
                                    {t.permissions.systemAudioPathNote}
                                </p>
                            </div>
                        </div>
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

                {/* Org display */}
                {monthlyUsage?.org_name && (
                    <div className="flex justify-between items-center py-3 hover:bg-zinc-900/20 -mx-3 px-3 rounded-md transition-colors">
                        <div>
                            <p className="text-sm text-zinc-300">{t.settings.organization}</p>
                        </div>
                        <span className="text-xs text-zinc-400">{monthlyUsage.org_name}</span>
                    </div>
                )}

                <button
                    onClick={() => window.electronAPI?.signOut()}
                    className="w-full flex justify-between items-center py-3 hover:bg-zinc-900/20 -mx-3 px-3 rounded-md transition-colors text-left"
                >
                    <div>
                        <p className="text-sm text-zinc-300">{t.settings.signOut}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">{t.settings.signOutHint}</p>
                    </div>
                    <LogOut size={16} className="text-zinc-500" />
                </button>
            </section>

            {/* Monthly Usage Section */}
            <section className="space-y-1 flex-1 flex flex-col min-h-[300px]">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t.settings.usage}</h2>
                    <span className="text-xs text-zinc-600">{t.settings.monthly}</span>
                </div>
                {loadingUsage ? (
                    <div className="flex-1 flex items-center justify-center">
                        <Loader2 size={20} className="animate-spin text-zinc-600" />
                    </div>
                ) : monthlyUsage ? (
                    <div className="space-y-1">
                        {/* Segmented Progress bar: used / limit */}
                        <div className="py-3 -mx-3 px-3">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm text-zinc-400">{t.settings.normalizedTokens}</span>
                                <span className="text-xs text-zinc-400">
                                    {formatTokens(monthlyUsage.normalized_tokens)} / {formatTokens(monthlyUsage.token_limit)}
                                </span>
                            </div>
                            
                            {(() => {
                                const realtimeTotal = monthlyUsage.raw_realtime_input_tokens + monthlyUsage.raw_realtime_output_tokens
                                const geminiTotal = monthlyUsage.raw_gemini_input_tokens + monthlyUsage.raw_gemini_output_tokens
                                const embeddingTotal = monthlyUsage.raw_embedding_tokens
                                const totalRaw = realtimeTotal + geminiTotal + embeddingTotal
                                
                                const segments = [
                                    { key: 'realtime', value: realtimeTotal, color: 'bg-amber-500' },
                                    { key: 'embedding', value: embeddingTotal, color: 'bg-blue-500' },
                                    { key: 'gemini', value: geminiTotal, color: 'bg-violet-500' },
                                ]

                                return (
                                    <>
                                        <div className="h-2.5 rounded-full overflow-hidden bg-zinc-800 mb-4 flex">
                                            {totalRaw === 0 ? (
                                                <div 
                                                    className={`h-full rounded-full transition-all ${usagePercent >= 90 ? 'bg-red-500' : usagePercent >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                                    style={{ width: `${usagePercent}%` }}
                                                />
                                            ) : (
                                                segments.map(seg => seg.value > 0 && (
                                                    <div
                                                        key={seg.key}
                                                        className={`h-full ${seg.color} transition-all`}
                                                        style={{ width: `${(seg.value / totalRaw) * usagePercent}%` }}
                                                    />
                                                ))
                                            )}
                                        </div>

                                        {/* Legend with counts */}
                                        <div className="space-y-2.5 mb-4">
                                            <div className="flex justify-between items-center text-xs">
                                                <div className="flex items-center gap-2">
                                                    <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                                                    <span className="text-zinc-400">{monthlyUsage.questions_count} {t.settings.questions}</span>
                                                </div>
                                                <span className="text-zinc-500">{t.settings.realtimeTokens}</span>
                                            </div>
                                            <div className="flex justify-between items-center text-xs">
                                                <div className="flex items-center gap-2">
                                                    <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                                                    <span className="text-zinc-400">{monthlyUsage.documents_count} {t.settings.documents}</span>
                                                </div>
                                                <span className="text-zinc-500">{t.settings.embeddingTokens}</span>
                                            </div>
                                            <div className="flex justify-between items-center text-xs">
                                                <div className="flex items-center gap-2">
                                                    <span className="w-2 h-2 rounded-full bg-violet-500 shrink-0" />
                                                    <span className="text-zinc-400">{t.settings.geminiTokens}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                )
                            })()}

                            <div className="flex justify-between items-center pt-2 border-t border-zinc-800/50">
                                <span className="text-xs text-zinc-500">{usagePercent.toFixed(1)}% {t.settings.usage}</span>
                            </div>
                        </div>
                    </div>

                ) : (
                    <p className="text-sm text-zinc-500 text-center py-8">{t.settings.noUsageDataYet}</p>
                )}
            </section>
        </div>
    )
}
