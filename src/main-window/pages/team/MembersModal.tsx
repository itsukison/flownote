import { useState, useEffect } from 'react'
import { Users, X, UserMinus, Shield, Loader2, ExternalLink } from 'lucide-react'
import { ja } from '@/i18n/ja'
import { formatTokens } from '@/utils/format'

const t = ja

interface Props {
    open: boolean
    onClose: () => void
    planInfo: PlanInfo
}

export default function MembersModal({ open, onClose, planInfo }: Props) {
    const [teamData, setTeamData] = useState<TeamMembersData | null>(null)
    const [loading, setLoading] = useState(true)
    const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
    const [removingId, setRemovingId] = useState<string | null>(null)

    const fetchMembers = async () => {
        setLoading(true)
        const data = await window.electronAPI?.getTeamMembers()
        setTeamData(data)
        setLoading(false)
    }

    useEffect(() => {
        if (open) {
            fetchMembers()
            setConfirmRemoveId(null)
        }
    }, [open])

    const handleRemove = async (userId: string) => {
        setRemovingId(userId)
        const result = await window.electronAPI?.removeMember(userId)
        setRemovingId(null)
        setConfirmRemoveId(null)
        if (result?.success) {
            fetchMembers()
        }
    }

    if (!open) return null

    const isAdmin = planInfo.isAdmin
    const tokenLimit = teamData?.org.normalized_token_limit_per_user ?? 1
    const members = teamData?.members ?? []

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col"
                style={{ maxHeight: '80vh' }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800 shrink-0">
                    <div className="flex items-center gap-2">
                        <Users size={18} className="text-blue-400" />
                        <h2 className="text-base font-semibold text-zinc-100">{t.team.membersModal.title}</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-1">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 size={20} className="animate-spin text-zinc-600" />
                        </div>
                    ) : !teamData ? (
                        <p className="text-xs text-zinc-500 text-center py-8">
                            {t.team.membersModal.loadingError}
                        </p>
                    ) : members.length === 0 ? (
                        <p className="text-xs text-zinc-500 text-center py-8">
                            {t.team.membersModal.noMembers}
                        </p>
                    ) : (
                        members.map((member) => {
                            const isMemberAdmin = member.role === 'admin'
                            const isSelf = isMemberAdmin && isAdmin // admin is always self in this context
                            const usagePct = tokenLimit > 0
                                ? Math.min(100, (member.normalized_tokens_used / tokenLimit) * 100)
                                : 0
                            const isConfirming = confirmRemoveId === member.user_id
                            const isRemoving = removingId === member.user_id

                            return (
                                <div
                                    key={member.user_id}
                                    className="flex items-center gap-3 py-2.5 px-3 -mx-3 rounded-xl hover:bg-zinc-800/40 transition-colors group"
                                >
                                    {/* Avatar */}
                                    <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-semibold text-zinc-400 shrink-0">
                                        {member.email[0]?.toUpperCase() ?? '?'}
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="text-sm text-zinc-200 truncate">{member.email}</span>
                                            {isMemberAdmin && (
                                                <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 shrink-0">
                                                    <Shield size={9} />
                                                    {t.team.membersModal.admin}
                                                </span>
                                            )}
                                            {isSelf && (
                                                <span className="text-[10px] text-zinc-600 shrink-0">
                                                    {t.team.membersModal.you}
                                                </span>
                                            )}
                                        </div>
                                        {/* Usage bar */}
                                        <div className="flex items-center gap-2 mt-1.5">
                                            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden w-24">
                                                <div
                                                    className={`h-full rounded-full transition-all ${
                                                        usagePct > 90 ? 'bg-red-500' :
                                                        usagePct > 70 ? 'bg-amber-500' :
                                                        'bg-blue-500'
                                                    }`}
                                                    style={{ width: `${usagePct}%` }}
                                                />
                                            </div>
                                            <span className="text-[10px] text-zinc-600 tabular-nums">
                                                {formatTokens(member.normalized_tokens_used)} / {formatTokens(tokenLimit)}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Remove — admin only, not self */}
                                    {isAdmin && !isMemberAdmin && (
                                        <div className="shrink-0">
                                            {isConfirming ? (
                                                <div className="flex items-center gap-1.5">
                                                    <button
                                                        onClick={() => handleRemove(member.user_id)}
                                                        disabled={isRemoving}
                                                        className="px-2.5 py-1 rounded-lg bg-red-500/20 text-red-400 text-[11px] font-medium hover:bg-red-500/30 transition-colors disabled:opacity-40 flex items-center gap-1"
                                                    >
                                                        {isRemoving
                                                            ? <Loader2 size={10} className="animate-spin" />
                                                            : t.team.membersModal.removeButton}
                                                    </button>
                                                    <button
                                                        onClick={() => setConfirmRemoveId(null)}
                                                        className="px-2 py-1 rounded-lg text-zinc-500 text-[11px] hover:text-zinc-300 transition-colors"
                                                    >
                                                        {t.common.cancel}
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => setConfirmRemoveId(member.user_id)}
                                                    className="p-1.5 rounded-lg text-zinc-700 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                                                    title={t.team.membersModal.removeMember}
                                                >
                                                    <UserMinus size={14} />
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )
                        })
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800 shrink-0">
                    <span className="text-xs text-zinc-500">
                        {teamData
                            ? t.team.membersModal.seatsUsed
                                .replace('{used}', String(members.length))
                                .replace('{total}', String(teamData.org.seat_count))
                            : '—'}
                    </span>
                    {isAdmin && (
                        <button
                            onClick={() => window.electronAPI?.openBillingPortal()}
                            className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                        >
                            {t.team.membersModal.addSeats}
                            <ExternalLink size={11} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}
