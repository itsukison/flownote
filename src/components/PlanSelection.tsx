import { useState } from 'react'
import { Crown, Users, Building2, Loader2, CheckCircle, AlertCircle, X, Plus, Minus, Mail, KeyRound } from 'lucide-react'
import { ja } from '@/i18n/ja'

const t = ja

// ─── Plan Cards ─────────────────────────────────────────────────────────────

interface PlanCardsProps {
    onProClick: () => void
    onBusinessClick: () => void
    onEnterpriseClick: () => void
    checkoutLoading: boolean
}

export function PlanCards({ onProClick, onBusinessClick, onEnterpriseClick, checkoutLoading }: PlanCardsProps) {
    return (
        <div className="grid grid-cols-3 gap-3">
            {/* Pro */}
            <button
                onClick={onProClick}
                disabled={checkoutLoading}
                className="flex flex-col items-start p-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.03] hover:bg-amber-500/[0.07] transition-all text-left group"
            >
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center mb-3">
                    <Crown size={16} className="text-amber-400" />
                </div>
                <p className="text-sm font-semibold text-zinc-200">Pro</p>
                <p className="text-xs text-zinc-500 mt-0.5">個人利用</p>
                <div className="mt-3">
                    <span className="text-lg font-bold text-zinc-200">¥1,500</span>
                    <span className="text-xs text-zinc-500">/月</span>
                </div>
                <div className="mt-3 w-full py-2 rounded-lg bg-amber-500 text-black text-xs font-semibold text-center group-hover:bg-amber-400 transition-colors">
                    {checkoutLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'アップグレード'}
                </div>
            </button>

            {/* Business */}
            <button
                onClick={onBusinessClick}
                className="flex flex-col items-start p-4 rounded-xl border border-blue-500/20 bg-blue-500/[0.03] hover:bg-blue-500/[0.07] transition-all text-left group"
            >
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center mb-3">
                    <Users size={16} className="text-blue-400" />
                </div>
                <p className="text-sm font-semibold text-zinc-200">ビジネス</p>
                <p className="text-xs text-zinc-500 mt-0.5">チーム向け・最低3席</p>
                <div className="mt-3">
                    <span className="text-lg font-bold text-zinc-200">¥1,250</span>
                    <span className="text-xs text-zinc-500">/席/月</span>
                </div>
                <div className="mt-3 w-full py-2 rounded-lg bg-blue-500 text-white text-xs font-semibold text-center group-hover:bg-blue-400 transition-colors">
                    チームで始める
                </div>
            </button>

            {/* Enterprise */}
            <button
                onClick={onEnterpriseClick}
                className="flex flex-col items-start p-4 rounded-xl border border-violet-500/20 bg-violet-500/[0.03] hover:bg-violet-500/[0.07] transition-all text-left group"
            >
                <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center mb-3">
                    <Building2 size={16} className="text-violet-400" />
                </div>
                <p className="text-sm font-semibold text-zinc-200">エンタープライズ</p>
                <p className="text-xs text-zinc-500 mt-0.5">大規模組織</p>
                <div className="mt-3">
                    <span className="text-lg font-bold text-zinc-200">要相談</span>
                </div>
                <div className="mt-3 w-full py-2 rounded-lg bg-violet-500/20 text-violet-300 text-xs font-semibold text-center group-hover:bg-violet-500/30 transition-colors">
                    お問い合わせ
                </div>
            </button>
        </div>
    )
}

// ─── Business Modal ─────────────────────────────────────────────────────────

type BusinessStep = 'choice' | 'seats' | 'code'

interface BusinessModalProps {
    open: boolean
    onClose: () => void
    onActivated: () => void
}

export function BusinessModal({ open, onClose, onActivated }: BusinessModalProps) {
    const [step, setStep] = useState<BusinessStep>('choice')
    const [seats, setSeats] = useState(3)
    const [checkoutLoading, setCheckoutLoading] = useState(false)
    const [code, setCode] = useState('')
    const [codeLoading, setCodeLoading] = useState(false)
    const [codeError, setCodeError] = useState<string | null>(null)
    const [codeSuccess, setCodeSuccess] = useState<string | null>(null)

    if (!open) return null

    const handleClose = () => {
        setStep('choice')
        setSeats(3)
        setCode('')
        setCodeError(null)
        setCodeSuccess(null)
        onClose()
    }

    const handleCheckout = async () => {
        setCheckoutLoading(true)
        const result = await window.electronAPI?.openCheckout('business', seats)
        setCheckoutLoading(false)
        if (result?.success) {
            handleClose()
        }
    }

    const handleActivateCode = async () => {
        if (!code.trim()) return
        setCodeLoading(true)
        setCodeError(null)
        const result = await window.electronAPI?.activateCode(code.trim().toUpperCase())
        setCodeLoading(false)
        if (result?.success) {
            setCodeSuccess(t.activation.success.replace('{org}', result.orgName || ''))
            setTimeout(() => {
                handleClose()
                onActivated()
            }, 1200)
        } else {
            const errorMessages: Record<string, string> = {
                invalid_code: t.activation.invalidCode,
                org_inactive: t.activation.orgInactive,
                org_full: t.activation.orgFull,
            }
            setCodeError(errorMessages[result?.error || ''] || t.activation.unknownError)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={handleClose}>
            <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                        <Users size={18} className="text-blue-400" />
                        <h2 className="text-base font-semibold text-zinc-100">
                            {step === 'choice' && 'ビジネスチーム'}
                            {step === 'seats' && 'チームの席数を選択'}
                            {step === 'code' && 'アクティベーションコード'}
                        </h2>
                    </div>
                    <button onClick={handleClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Choice step */}
                {step === 'choice' && (
                    <div className="space-y-3">
                        <button
                            onClick={() => setStep('seats')}
                            className="w-full flex items-start gap-4 p-4 rounded-xl border border-zinc-800 hover:border-blue-500/30 hover:bg-blue-500/[0.03] transition-all text-left"
                        >
                            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5">
                                <Building2 size={18} className="text-blue-400" />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-zinc-200">新しいチームを作成</p>
                                <p className="text-xs text-zinc-500 mt-1 leading-relaxed">管理者としてチームを作成し、メンバーを招待します</p>
                            </div>
                        </button>

                        <button
                            onClick={() => setStep('code')}
                            className="w-full flex items-start gap-4 p-4 rounded-xl border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/30 transition-all text-left"
                        >
                            <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center shrink-0 mt-0.5">
                                <KeyRound size={18} className="text-zinc-400" />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-zinc-200">アクティベーションコードで参加</p>
                                <p className="text-xs text-zinc-500 mt-1 leading-relaxed">管理者から受け取ったコードを入力してチームに参加します</p>
                            </div>
                        </button>
                    </div>
                )}

                {/* Seats step */}
                {step === 'seats' && (
                    <div className="space-y-6">
                        <div className="flex items-center justify-center gap-4">
                            <button
                                onClick={() => setSeats(s => Math.max(3, s - 1))}
                                disabled={seats <= 3}
                                className="w-10 h-10 rounded-xl border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                <Minus size={16} />
                            </button>
                            <div className="text-center min-w-[80px]">
                                <span className="text-3xl font-bold text-zinc-100">{seats}</span>
                                <span className="text-sm text-zinc-500 ml-1">席</span>
                            </div>
                            <button
                                onClick={() => setSeats(s => Math.min(100, s + 1))}
                                className="w-10 h-10 rounded-xl border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
                            >
                                <Plus size={16} />
                            </button>
                        </div>

                        <div className="text-center">
                            <p className="text-lg font-bold text-zinc-200">
                                ¥{(seats * 1250).toLocaleString()}<span className="text-sm font-normal text-zinc-500">/月</span>
                            </p>
                            <p className="text-xs text-zinc-500 mt-1">¥1,250 × {seats}席</p>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setStep('choice')}
                                className="flex-1 py-2.5 rounded-xl border border-zinc-800 text-sm text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition-colors"
                            >
                                戻る
                            </button>
                            <button
                                onClick={handleCheckout}
                                disabled={checkoutLoading}
                                className="flex-1 py-2.5 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-400 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                            >
                                {checkoutLoading ? <Loader2 size={14} className="animate-spin" /> : '購入に進む'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Code step */}
                {step === 'code' && (
                    <div className="space-y-4">
                        <p className="text-xs text-zinc-500">{t.activation.description}</p>

                        <input
                            type="text"
                            value={code}
                            onChange={(e) => setCode(e.target.value.toUpperCase())}
                            placeholder="FN-XXXXXX"
                            maxLength={9}
                            className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700 tracking-widest text-center font-mono"
                            disabled={codeLoading || !!codeSuccess}
                            autoFocus
                        />

                        {codeError && (
                            <div className="flex items-center gap-2 text-red-400 text-xs">
                                <AlertCircle size={14} />
                                <span>{codeError}</span>
                            </div>
                        )}

                        {codeSuccess && (
                            <div className="flex items-center gap-2 text-emerald-400 text-xs">
                                <CheckCircle size={14} />
                                <span>{codeSuccess}</span>
                            </div>
                        )}

                        <div className="flex gap-3">
                            <button
                                onClick={() => { setStep('choice'); setCode(''); setCodeError(null) }}
                                className="flex-1 py-2.5 rounded-xl border border-zinc-800 text-sm text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition-colors"
                            >
                                戻る
                            </button>
                            <button
                                onClick={handleActivateCode}
                                disabled={codeLoading || !code.trim() || !!codeSuccess}
                                className="flex-1 py-2.5 rounded-xl bg-zinc-100 text-zinc-900 text-sm font-semibold hover:bg-white transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                            >
                                {codeLoading ? <Loader2 size={14} className="animate-spin" /> : t.activation.activate}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

// ─── Enterprise Modal ───────────────────────────────────────────────────────

interface EnterpriseModalProps {
    open: boolean
    onClose: () => void
    userEmail?: string
}

export function EnterpriseModal({ open, onClose, userEmail }: EnterpriseModalProps) {
    if (!open) return null

    const subject = encodeURIComponent('Flownote エンタープライズプランのお問い合わせ')
    const body = encodeURIComponent(`\n\n---\nアカウント: ${userEmail || ''}`)
    const mailtoUrl = `mailto:itsukison00@gmail.com?subject=${subject}&body=${body}`

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                        <Building2 size={18} className="text-violet-400" />
                        <h2 className="text-base font-semibold text-zinc-100">エンタープライズ</h2>
                    </div>
                    <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <p className="text-sm text-zinc-400 mb-5 leading-relaxed">
                    大規模組織向けのカスタムプランです。以下のボタンからお問い合わせください。
                </p>

                <ul className="space-y-2 mb-6">
                    {['カスタムトークン上限', '専任オンボーディング', '請求書払い対応', '優先サポート'].map(feat => (
                        <li key={feat} className="flex items-center gap-2 text-xs text-zinc-500">
                            <CheckCircle size={14} className="text-violet-400 shrink-0" />
                            {feat}
                        </li>
                    ))}
                </ul>

                <div className="flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-2.5 rounded-xl border border-zinc-800 text-sm text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition-colors"
                    >
                        キャンセル
                    </button>
                    <a
                        href={mailtoUrl}
                        className="flex-1 py-2.5 rounded-xl bg-violet-500 text-white text-sm font-semibold hover:bg-violet-400 transition-colors flex items-center justify-center gap-2"
                    >
                        <Mail size={14} />
                        メールで問い合わせる
                    </a>
                </div>
            </div>
        </div>
    )
}
