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

function estimateCostJPY(normalizedTokens: number): string {
    const usd = (normalizedTokens / 1_000_000) * COST_PER_MILLION
    const jpy = Math.round(usd * JPY_RATE)
    return `¥${jpy.toLocaleString()}`
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
                <div className="py-3 space-y-3">
                    <div>
                        <p className="text-sm text-zinc-300">{t.permissions.systemAudio}</p>
                        <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{t.permissions.systemAudioHint}</p>
                    </div>
                    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3 text-xs text-zinc-400 font-mono leading-relaxed">
                        <p>{t.permissions.systemAudioPath}</p>
                        <p className="text-zinc-600 mt-1.5">{t.permissions.systemAudioPathNote}</p>
                    </div>
                    <button
                        onClick={() => window.electronAPI?.openSystemAudioSettings()}
                        className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-xs text-zinc-500 transition-all"
                    >
                        {t.permissions.openSettings}
                    </button>
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
                        {/* Progress bar: used / limit */}
                        <div className="py-3 -mx-3 px-3">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm text-zinc-400">{t.settings.normalizedTokens}</span>
                                <span className="text-xs text-zinc-400">
                                    {formatTokens(monthlyUsage.normalized_tokens)} / {formatTokens(monthlyUsage.token_limit)}
                                </span>
                            </div>
                            <div className="h-2.5 rounded-full overflow-hidden bg-zinc-800 mb-2">
                                <div
                                    className={`h-full rounded-full transition-all ${usagePercent >= 90 ? 'bg-red-500' : usagePercent >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                    style={{ width: `${usagePercent}%` }}
                                />
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs text-zinc-500">{usagePercent.toFixed(1)}%</span>
                                <span className="text-xs text-zinc-500">
                                    {t.settings.estimatedCost}: {estimateCostJPY(monthlyUsage.normalized_tokens)}
                                </span>
                            </div>
                        </div>

                        <div className="flex justify-between items-center py-3 hover:bg-zinc-900/20 -mx-3 px-3 rounded-md transition-colors">
                            <span className="text-sm text-zinc-400">{t.settings.questions}</span>
                            <span className="text-sm text-zinc-300">{monthlyUsage.questions_count}</span>
                        </div>
                        <div className="flex justify-between items-center py-3 hover:bg-zinc-900/20 -mx-3 px-3 rounded-md transition-colors">
                            <span className="text-sm text-zinc-400">{t.settings.documents}</span>
                            <span className="text-sm text-zinc-300">{monthlyUsage.documents_count}</span>
                        </div>

                        {/* Raw token breakdown */}
                        <div className="py-3 -mx-3 px-3">
                            <p className="text-sm text-zinc-400 mb-3">{t.settings.tokenBreakdown}</p>
                            {(() => {
                                const realtimeTotal = monthlyUsage.raw_realtime_input_tokens + monthlyUsage.raw_realtime_output_tokens
                                const geminiTotal = monthlyUsage.raw_gemini_input_tokens + monthlyUsage.raw_gemini_output_tokens
                                const embeddingTotal = monthlyUsage.raw_embedding_tokens
                                const total = realtimeTotal + geminiTotal + embeddingTotal
                                const segments = [
                                    { key: 'realtime', value: realtimeTotal, label: t.settings.realtimeTokens, color: 'bg-amber-500' },
                                    { key: 'embedding', value: embeddingTotal, label: t.settings.embeddingTokens, color: 'bg-blue-500' },
                                    { key: 'gemini', value: geminiTotal, label: t.settings.geminiTokens, color: 'bg-violet-500' },
                                ]
                                return (
                                    <>
                                        <div className="h-2 rounded-full overflow-hidden bg-zinc-800 flex mb-3">
                                            {total === 0 ? (
                                                <div className="h-full w-full bg-zinc-800" />
                                            ) : (
                                                segments.map(seg => seg.value > 0 && (
                                                    <div
                                                        key={seg.key}
                                                        className={`h-full ${seg.color} transition-all`}
                                                        style={{ width: `${(seg.value / total) * 100}%` }}
                                                    />
                                                ))
                                            )}
                                        </div>
                                        <div className="flex flex-col gap-1.5">
                                            {segments.map(seg => (
                                                <div key={seg.key} className="flex justify-between items-center">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`w-2 h-2 rounded-full ${seg.color} shrink-0`} />
                                                        <span className="text-xs text-zinc-500">{seg.label}</span>
                                                    </div>
                                                    <span className="text-xs text-zinc-400">{seg.value.toLocaleString()}</span>
                                                </div>
                                            ))}
                                        </div>
                                        {total === 0 && (
                                            <p className="text-xs text-zinc-600 text-center mt-2">{t.settings.noUsageDataYet}</p>
                                        )}
                                    </>
                                )
                            })()}
                        </div>
                    </div>
                ) : (
                    <p className="text-sm text-zinc-500 text-center py-8">{t.settings.noUsageDataYet}</p>
                )}
            </section>
        </div>
    )
}
