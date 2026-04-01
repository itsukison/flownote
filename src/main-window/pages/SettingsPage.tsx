import { useState, useEffect, useRef, useCallback } from 'react'
import { LogOut, Loader2, Crown, Building2, ExternalLink } from 'lucide-react'
import { ja } from '@/i18n/ja'
import { Button } from '@/components/ui/button'
import { PlanCards, BusinessModal, EnterpriseModal } from '@/components/PlanSelection'

const t = ja

const PLAN_LABELS: Record<string, string> = {
  free: 'フリー',
  pro: 'パーソナル Pro',
  business: 'ビジネスチーム',
  enterprise: 'エンタープライズ',
}

const STATUS_LABELS: Record<string, string> = {
  active: '有効',
  past_due: '支払い遅延',
  canceled: 'キャンセル済み',
  none: '—',
}

function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
    return n.toLocaleString()
}

const NORM = {
    REALTIME_INPUT: 6,
    REALTIME_OUTPUT: 24,
    GEMINI_INPUT: 1,
    GEMINI_OUTPUT: 4,
    EMBEDDING_INPUT: 0.2,
    TRANSCRIPTION_MS: 0.01,
} as const

function UsageBar({ monthlyUsage, usagePercent }: { monthlyUsage: MonthlyUsage; usagePercent: number }) {
    const barRef = useRef<HTMLDivElement>(null)
    const [tooltip, setTooltip] = useState<{ x: number; label: string; norm: number; pct: number } | null>(null)

    const realtimeNorm = Math.round(monthlyUsage.raw_realtime_input_tokens * NORM.REALTIME_INPUT + monthlyUsage.raw_realtime_output_tokens * NORM.REALTIME_OUTPUT)
    const geminiNorm   = Math.round(monthlyUsage.raw_gemini_input_tokens * NORM.GEMINI_INPUT + monthlyUsage.raw_gemini_output_tokens * NORM.GEMINI_OUTPUT)
    const embeddingNorm = Math.round(monthlyUsage.raw_embedding_tokens * NORM.EMBEDDING_INPUT)
    const transcriptionNorm = Math.round(monthlyUsage.raw_transcription_audio_ms * NORM.TRANSCRIPTION_MS)

    const limit = monthlyUsage.token_limit || 1

    const segments = [
        { key: 'realtime',      norm: realtimeNorm,      color: 'bg-amber-500',   hoverColor: 'bg-amber-400',   label: t.settings.realtimeTokens },
        { key: 'gemini',        norm: geminiNorm,         color: 'bg-violet-500',  hoverColor: 'bg-violet-400',  label: t.settings.geminiTokens },
        { key: 'embedding',     norm: embeddingNorm,      color: 'bg-blue-500',    hoverColor: 'bg-blue-400',    label: t.settings.embeddingTokens },
        { key: 'transcription', norm: transcriptionNorm,  color: 'bg-emerald-500', hoverColor: 'bg-emerald-400', label: t.settings.transcriptionTokens },
    ]

    const handleSegmentEnter = useCallback((e: React.MouseEvent<HTMLDivElement>, seg: typeof segments[0]) => {
        const barRect = barRef.current?.getBoundingClientRect()
        const segRect = e.currentTarget.getBoundingClientRect()
        if (!barRect) return
        const centerX = segRect.left + segRect.width / 2 - barRect.left
        const pct = limit > 0 ? (seg.norm / limit) * 100 : 0
        setTooltip({ x: centerX, label: seg.label, norm: seg.norm, pct })
    }, [limit])

    const legendRows = [
        { key: 'realtime',      norm: realtimeNorm,      dotColor: 'bg-amber-500',   label: t.settings.realtimeTokens,      sub: `${monthlyUsage.questions_count} ${t.settings.questions}` },
        { key: 'gemini',        norm: geminiNorm,         dotColor: 'bg-violet-500',  label: t.settings.geminiTokens,        sub: null },
        { key: 'embedding',     norm: embeddingNorm,      dotColor: 'bg-blue-500',    label: t.settings.embeddingTokens,     sub: `${monthlyUsage.documents_count} ${t.settings.documents}` },
        { key: 'transcription', norm: transcriptionNorm,  dotColor: 'bg-emerald-500', label: t.settings.transcriptionTokens, sub: null },
    ]

    return (
        <div className="space-y-1">
            <div className="py-3 -mx-3 px-3">
                <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-zinc-400">{t.settings.normalizedTokens}</span>
                    <span className="text-xs text-zinc-400">
                        {formatTokens(monthlyUsage.normalized_tokens)} / {formatTokens(monthlyUsage.token_limit)}
                    </span>
                </div>

                <div className="relative mb-4" ref={barRef} onMouseLeave={() => setTooltip(null)}>
                    <div className="h-2.5 rounded-full overflow-hidden bg-zinc-800 flex">
                        {segments.map(seg => seg.norm > 0 && (
                            <div
                                key={seg.key}
                                className={`h-full transition-all cursor-default ${tooltip?.label === seg.label ? seg.hoverColor : seg.color}`}
                                style={{ width: `${Math.min((seg.norm / limit) * 100, 100)}%` }}
                                onMouseEnter={(e) => handleSegmentEnter(e, seg)}
                            />
                        ))}
                        {segments.every(s => s.norm === 0) && (
                            <div className="h-full rounded-full bg-zinc-700 transition-all" style={{ width: `${usagePercent}%` }} />
                        )}
                    </div>

                    {tooltip && (
                        <div
                            className="absolute -top-9 pointer-events-none z-10"
                            style={{ left: tooltip.x, transform: 'translateX(-50%)' }}
                        >
                            <div className="bg-zinc-800 border border-zinc-700 text-white text-[11px] px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg">
                                <span className="text-zinc-300">{tooltip.label}</span>
                                <span className="text-zinc-500 mx-1">·</span>
                                <span className="text-zinc-400">{formatTokens(tooltip.norm)}</span>
                                <span className="text-zinc-600 ml-1">({tooltip.pct.toFixed(1)}%)</span>
                            </div>
                            <div className="w-2 h-2 bg-zinc-800 border-b border-r border-zinc-700 rotate-45 mx-auto -mt-1" />
                        </div>
                    )}
                </div>

                <div className="space-y-2.5 mb-4">
                    {legendRows.map(row => (
                        <div key={row.key} className="flex justify-between items-center text-xs">
                            <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${row.dotColor} shrink-0`} />
                                <span className="text-zinc-400">{row.label}</span>
                                {row.sub && <span className="text-zinc-600">{row.sub}</span>}
                            </div>
                            <span className="text-zinc-500 tabular-nums">{formatTokens(row.norm)}</span>
                        </div>
                    ))}
                </div>

                <div className="flex justify-between items-center pt-2 border-t border-zinc-800/50">
                    <span className="text-xs text-zinc-500">{usagePercent.toFixed(1)}% {t.settings.usage}</span>
                </div>
            </div>
        </div>
    )
}

interface Props {
    user: any
}

export default function SettingsPage({ user }: Props) {
    const [monthlyUsage, setMonthlyUsage] = useState<MonthlyUsage | null>(null)
    const [loadingUsage, setLoadingUsage] = useState(true)
    const [autoSummaryEnabled, setAutoSummaryEnabled] = useState(false)
    const [autoSummaryLoading, setAutoSummaryLoading] = useState(true)
    const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null)
    const [checkoutLoading, setCheckoutLoading] = useState(false)
    const [businessModalOpen, setBusinessModalOpen] = useState(false)
    const [enterpriseModalOpen, setEnterpriseModalOpen] = useState(false)

    const refreshPlanData = () => {
        window.electronAPI?.getPlanInfo().then(setPlanInfo)
        window.electronAPI?.getMonthlyUsage().then(setMonthlyUsage)
    }

    useEffect(() => {
        setLoadingUsage(true)
        window.electronAPI?.getMonthlyUsage().then((u) => {
            setMonthlyUsage(u)
            setLoadingUsage(false)
        })
        window.electronAPI?.getPlanInfo().then(setPlanInfo)
        window.electronAPI?.getProfileSettings().then((result) => {
            if (result?.success) setAutoSummaryEnabled(result.auto_summary_enabled)
        }).finally(() => setAutoSummaryLoading(false))

        const unsubPlan = window.electronAPI?.onPlanChanged(() => refreshPlanData())
        return () => { unsubPlan?.() }
    }, [])

    const usagePercent = monthlyUsage && monthlyUsage.token_limit > 0
        ? Math.min(100, (monthlyUsage.normalized_tokens / monthlyUsage.token_limit) * 100)
        : 0

    const handleProUpgrade = async () => {
        setCheckoutLoading(true)
        const result = await window.electronAPI?.openCheckout('pro')
        setCheckoutLoading(false)
        if (!result?.success) {
            console.error('Checkout failed:', result?.error)
        }
    }

    const isFree = !planInfo || planInfo.plan === 'free'
    const isPaid = planInfo && (planInfo.plan === 'pro' || planInfo.plan === 'business' || planInfo.plan === 'enterprise')

    return (
        <div className="max-w-2xl mx-auto px-8 py-8">
            <h1 className="text-2xl font-semibold text-zinc-100 mb-8">{t.settings.title}</h1>

            {/* ── 1. Account ─────────────────────────────────────────── */}
            <section className="space-y-1 mb-10">
                <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4">{t.settings.account}</h2>
                <div className="flex justify-between items-center py-3 hover:bg-zinc-900/20 -mx-3 px-3 rounded-md transition-colors">
                    <div>
                        <p className="text-sm text-zinc-300">{t.settings.email}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">{t.settings.accountEmail}</p>
                    </div>
                    <span className="text-xs text-zinc-400 font-mono">{user?.email}</span>
                </div>

                {planInfo?.orgName && (
                    <div className="flex justify-between items-center py-3 hover:bg-zinc-900/20 -mx-3 px-3 rounded-md transition-colors">
                        <div>
                            <p className="text-sm text-zinc-300">{t.settings.organization}</p>
                        </div>
                        <span className="text-xs text-zinc-400">{planInfo.orgName}</span>
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

            {/* ── 2. Permissions ──────────────────────────────────────── */}
            <section className="space-y-1 mb-10">
                <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4">{t.permissions.title}</h2>
                <div className="space-y-2">
                    <div className="flex gap-4 py-4 -mx-3 px-3 hover:bg-zinc-900/20 rounded-xl transition-colors">
                        <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center shrink-0 border border-zinc-800 text-xs font-bold text-zinc-400">1</div>
                        <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start gap-4">
                                <div className="flex-1">
                                    <p className="text-sm font-medium text-zinc-200">{t.permissions.openSettings}</p>
                                    <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                                        {t.permissions.systemAudioHint}
                                    </p>
                                </div>
                                <Button
                                    onClick={() => window.electronAPI?.openSystemAudioSettings()}
                                    className="px-4 py-2 bg-zinc-100 text-zinc-950 hover:bg-zinc-200 rounded-lg text-xs transition-all font-semibold shrink-0"
                                >
                                    {t.permissions.openSettings}
                                </Button>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-4 py-4 -mx-3 px-3 hover:bg-zinc-900/20 rounded-xl transition-colors">
                        <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center shrink-0 border border-zinc-800 text-xs font-bold text-zinc-400">2</div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-zinc-200">{t.permissions.systemAudio}</p>
                            <div className="mt-3 p-3 bg-zinc-950/50 border border-zinc-800 rounded-xl space-y-2 max-w-fit">
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

            {/* ── 3. Auto-Summary ─────────────────────────────────────── */}
            <section className="space-y-1 mb-10">
                <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4">{t.settings.autoSummary.title}</h2>
                <div className="flex justify-between items-center py-3 hover:bg-zinc-900/20 -mx-3 px-3 rounded-md transition-colors">
                    <div>
                        <p className="text-sm text-zinc-300">{t.settings.autoSummary.title}</p>
                        <p className="text-xs text-zinc-500 mt-0.5 max-w-sm leading-relaxed">{t.settings.autoSummary.description}</p>
                    </div>
                    <button
                        onClick={async () => {
                            const next = !autoSummaryEnabled
                            setAutoSummaryEnabled(next)
                            await window.electronAPI?.setAutoSummary(next)
                        }}
                        disabled={autoSummaryLoading}
                        className={`w-9 h-5 rounded-full relative transition-colors flex-none ${
                            autoSummaryEnabled ? 'bg-green-500/40' : 'bg-zinc-700'
                        }`}
                    >
                        <div
                            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                                autoSummaryEnabled ? 'left-[18px]' : 'left-0.5'
                            }`}
                        />
                    </button>
                </div>
            </section>

            {/* ── 4. Plan + Usage ──────────────────────────────────────── */}
            <section className="space-y-1 mb-10">
                <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4">プラン</h2>

                {/* Paid user: plan badge + status + billing portal */}
                {isPaid && (
                    <>
                        <div className="flex justify-between items-center py-3 -mx-3 px-3 rounded-md">
                            <div className="flex items-center gap-2">
                                {planInfo.plan === 'pro' && <Crown size={14} className="text-amber-400" />}
                                {(planInfo.plan === 'business' || planInfo.plan === 'enterprise') && <Building2 size={14} className="text-violet-400" />}
                                <p className="text-sm text-zinc-300">{PLAN_LABELS[planInfo.plan]}</p>
                                {!planInfo.cancelAtPeriodEnd && planInfo.subscriptionStatus !== 'none' && (
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                        planInfo.subscriptionStatus === 'active' ? 'bg-emerald-500/20 text-emerald-400' :
                                        planInfo.subscriptionStatus === 'past_due' ? 'bg-amber-500/20 text-amber-400' :
                                        'bg-zinc-700 text-zinc-400'
                                    }`}>
                                        {STATUS_LABELS[planInfo.subscriptionStatus]}
                                    </span>
                                )}
                                {planInfo.cancelAtPeriodEnd && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
                                        キャンセル予定
                                    </span>
                                )}
                            </div>
                            {(planInfo.plan === 'pro' || planInfo.plan === 'business') && (
                                <button
                                    onClick={() => window.electronAPI?.openBillingPortal()}
                                    className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                                >
                                    プランを変更・キャンセル <ExternalLink size={11} />
                                </button>
                            )}
                        </div>

                        {/* Cancellation banner */}
                        {planInfo.cancelAtPeriodEnd && planInfo.currentPeriodEnd && (
                            <div className="py-3 px-4 -mx-3 rounded-xl bg-amber-500/[0.06] border border-amber-500/20">
                                <p className="text-sm text-amber-300/90">
                                    プランは {new Date(planInfo.currentPeriodEnd).toLocaleDateString('ja-JP')} に終了します。
                                </p>
                                <p className="text-xs text-amber-400/60 mt-1">
                                    それまで{PLAN_LABELS[planInfo.plan]}の全機能をご利用いただけます。キャンセルを取り消すには「プランを変更・キャンセル」から操作してください。
                                </p>
                            </div>
                        )}
                    </>
                )}

                {/* Free user: upgrade cards */}
                {isFree && (
                    <div className="py-3 -mx-3 px-3 space-y-4">
                        <div className="flex items-center gap-2">
                            <p className="text-sm text-zinc-300">{PLAN_LABELS.free}</p>
                        </div>
                        <p className="text-xs text-zinc-500">
                            {planInfo && planInfo.freeCreditsRemaining > 0
                                ? `無料クレジット残量: ${formatTokens(planInfo.freeCreditsRemaining)}`
                                : '無料クレジットを使い切りました'}
                        </p>
                        <PlanCards
                            onProClick={handleProUpgrade}
                            onBusinessClick={() => setBusinessModalOpen(true)}
                            onEnterpriseClick={() => setEnterpriseModalOpen(true)}
                            checkoutLoading={checkoutLoading}
                        />
                    </div>
                )}
            </section>

            <section className="space-y-1 flex-1 flex flex-col min-h-[300px]">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{t.settings.usage}</h2>
                    <span className="text-xs text-zinc-600">{isFree ? 'トライアル' : t.settings.monthly}</span>
                </div>
                {loadingUsage ? (
                    <div className="flex-1 flex items-center justify-center">
                        <Loader2 size={20} className="animate-spin text-zinc-600" />
                    </div>
                ) : monthlyUsage ? (
                    <UsageBar monthlyUsage={monthlyUsage} usagePercent={usagePercent} />
                ) : (
                    <p className="text-sm text-zinc-500 text-center py-8">{t.settings.noUsageDataYet}</p>
                )}
            </section>

            {/* Modals */}
            <BusinessModal
                open={businessModalOpen}
                onClose={() => setBusinessModalOpen(false)}
                onActivated={refreshPlanData}
            />
            <EnterpriseModal
                open={enterpriseModalOpen}
                onClose={() => setEnterpriseModalOpen(false)}
                userEmail={user?.email}
            />
        </div>
    )
}
