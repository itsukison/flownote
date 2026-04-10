import { useState, useEffect } from 'react'
import { Building2, Copy, Check, Loader2, Shield, Users } from 'lucide-react'
import { ja } from '@/i18n/ja'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import MembersModal from './team/MembersModal'

const t = ja

interface Props {
    user: any
}

export default function TeamPage({ user }: Props) {
    const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null)
    const [sharingDefaults, setSharingDefaults] = useState<SharingDefaults>({
        collections: 'private',
        prompts: 'private',
        workflows: 'private',
    })
    const [adminData, setAdminData] = useState<OrgAdminDashboard | null>(null)
    const [loading, setLoading] = useState(true)
    const [copied, setCopied] = useState(false)
    const [membersModalOpen, setMembersModalOpen] = useState(false)

    const loadData = async () => {
        const info = await window.electronAPI?.getPlanInfo()
        setPlanInfo(info ?? null)

        const defaults = await window.electronAPI?.getSharingDefaults()
        if (defaults?.success && defaults.data) setSharingDefaults(defaults.data)

        if (info?.isAdmin) {
            const dash = await window.electronAPI?.getAdminDashboard()
            setAdminData(dash ?? null)
        }

        setLoading(false)
    }

    useEffect(() => {
        loadData()
        const unsubPlan = window.electronAPI?.onPlanChanged(() => loadData())
        return () => { unsubPlan?.() }
    }, [])

    const handleCopy = async (text: string) => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
    }

    if (loading) {
        return (
            <div className="max-w-2xl mx-auto px-8 py-8 flex items-center justify-center min-h-[300px]">
                <Loader2 size={20} className="animate-spin text-zinc-600" />
            </div>
        )
    }

    const isAdmin = planInfo?.isAdmin ?? false
    const memberCount = adminData?.members.length ?? 0
    const seatCount = adminData?.org.seat_count ?? 0

    return (
        <div className="max-w-2xl mx-auto px-8 py-8">
            <h1 className="text-2xl font-semibold text-zinc-100 mb-8">{t.team.title}</h1>

            {/* ── Org Header ─────────────────────────────────────────────── */}
            <section className="mb-10">
                <div className="flex items-center gap-3 py-3">
                    <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                        <Building2 size={18} className="text-blue-400" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-zinc-200">{planInfo?.orgName ?? '—'}</p>
                            {isAdmin && (
                                <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400">
                                    <Shield size={9} />
                                    {t.team.adminBadge}
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-zinc-500 mt-0.5">{user?.email}</p>
                    </div>
                </div>
            </section>

            {/* ── Activation Code (admin only) ──────────────────────────── */}
            {isAdmin && (
                <section className="mb-10">
                    <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4">
                        {t.sharing.title}
                    </h2>
                    <p className="text-xs text-zinc-500 mb-3">{t.team.activationCodeHint}</p>
                    {adminData?.activation_code ? (
                        <div className="flex items-center gap-3">
                            <div className="flex-1 px-4 py-3 bg-zinc-950 border border-zinc-800 rounded-xl font-mono text-base text-zinc-100 tracking-[0.2em] text-center select-all">
                                {adminData.activation_code}
                            </div>
                            <button
                                onClick={() => handleCopy(adminData.activation_code!)}
                                className="w-10 h-10 rounded-xl border border-zinc-800 flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:border-zinc-700 transition-colors shrink-0"
                                title={copied ? t.team.copied : ''}
                            >
                                {copied
                                    ? <Check size={16} className="text-emerald-400" />
                                    : <Copy size={16} />}
                            </button>
                        </div>
                    ) : (
                        <p className="text-xs text-zinc-600">{t.team.noCode}</p>
                    )}
                </section>
            )}

            {/* ── Members ───────────────────────────────────────────────── */}
            <section className="mb-10">
                <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4">
                    {t.team.membersSection}
                </h2>
                <div className="flex items-center justify-between py-3 -mx-3 px-3 hover:bg-zinc-900/20 rounded-xl transition-colors">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center">
                            <Users size={15} className="text-zinc-400" />
                        </div>
                        <div>
                            <p className="text-sm text-zinc-300">
                                {isAdmin && adminData
                                    ? `${memberCount} / ${seatCount} 席`
                                    : planInfo?.orgName ?? '—'}
                            </p>
                            {isAdmin && (
                                <p className="text-xs text-zinc-600 mt-0.5">
                                    {t.team.membersModal.seatsUsed
                                        .replace('{used}', String(memberCount))
                                        .replace('{total}', String(seatCount))}
                                </p>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={() => setMembersModalOpen(true)}
                        className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 transition-colors"
                    >
                        {isAdmin ? t.team.manageMembers : t.team.viewMembers}
                    </button>
                </div>
            </section>

            {/* ── Sharing Defaults ──────────────────────────────────────── */}
            <section className="mb-10">
                <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4">
                    {t.team.sharingDefaults}
                </h2>
                <div className="py-3 -mx-3 px-3">
                    <p className="text-xs text-zinc-500 mb-4">{t.sharing.defaultVisibilityHint}</p>
                    {([
                        { key: 'collections' as const, label: t.sharing.collections },
                        { key: 'prompts' as const, label: t.sharing.prompts },
                        { key: 'workflows' as const, label: t.sharing.workflows },
                    ]).map(({ key, label }) => (
                        <div key={key} className="flex justify-between items-center py-2.5">
                            <span className="text-sm text-zinc-300 min-w-[120px] shrink-0">{label}</span>
                            <Select
                                value={sharingDefaults[key]}
                                onValueChange={async (value) => {
                                    const next = { ...sharingDefaults, [key]: value as VisibilityLevel }
                                    setSharingDefaults(next)
                                    await window.electronAPI?.setSharingDefaults({ [key]: value })
                                }}
                            >
                                <SelectTrigger className="w-[220px] h-8 bg-zinc-800 border-zinc-700 text-xs text-zinc-300 rounded-lg focus:ring-zinc-600 focus:ring-offset-0 shrink-0">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-zinc-900 border-zinc-700 rounded-lg">
                                    <SelectItem value="private" className="text-xs text-zinc-300 focus:bg-zinc-800 focus:text-zinc-100">
                                        {t.sharing.private}
                                    </SelectItem>
                                    <SelectItem value="team_view" className="text-xs text-zinc-300 focus:bg-zinc-800 focus:text-zinc-100">
                                        {t.sharing.teamView}
                                    </SelectItem>
                                    <SelectItem value="team_edit" className="text-xs text-zinc-300 focus:bg-zinc-800 focus:text-zinc-100">
                                        {t.sharing.teamEdit}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    ))}
                </div>
            </section>

            {/* Members Modal */}
            {planInfo && (
                <MembersModal
                    open={membersModalOpen}
                    onClose={() => setMembersModalOpen(false)}
                    planInfo={planInfo}
                />
            )}
        </div>
    )
}
