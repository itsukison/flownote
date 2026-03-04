import { useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'

interface Props {
    onAuth: (session: any) => void
}

export default function AuthPage({ onAuth }: Props) {
    const [mode, setMode] = useState<'signin' | 'signup'>('signin')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPw, setShowPw] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [info, setInfo] = useState<string | null>(null)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)
        setInfo(null)
        if (!email || !password) { setError('Please fill in all fields'); return }
        setLoading(true)
        try {
            if (mode === 'signin') {
                const res = await window.electronAPI.signIn(email, password)
                if (!res.success) { setError(res.error || 'Sign in failed'); return }
                const { session } = await window.electronAPI.getSession()
                onAuth(session)
            } else {
                const res = await window.electronAPI.signUp(email, password)
                if (!res.success) { setError(res.error || 'Sign up failed'); return }
                if (res.session) {
                    onAuth(res.session)
                } else {
                    setInfo('Check your email for a confirmation link, then sign in.')
                    setMode('signin')
                }
            }
        } catch (e: any) {
            setError(e.message || 'Something went wrong')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex items-center justify-center h-screen w-full bg-[#0e0e10]">
            <div className="w-full max-w-sm px-6">
                {/* Logo */}
                <div className="mb-8 text-center">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-600/20 border border-white/10 mb-4">
                        <span className="text-lg font-bold text-white">F</span>
                    </div>
                    <h1 className="text-xl font-semibold text-white">FlowNote</h1>
                    <p className="text-sm text-white/40 mt-1">AI-powered meeting assistant</p>
                </div>

                {/* Tabs */}
                <div className="flex bg-white/[0.04] rounded-xl p-1 mb-6 border border-white/[0.06]">
                    {(['signin', 'signup'] as const).map((m) => (
                        <button
                            key={m}
                            onClick={() => { setMode(m); setError(null); setInfo(null) }}
                            className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${mode === m ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'
                                }`}
                        >
                            {m === 'signin' ? 'Sign in' : 'Sign up'}
                        </button>
                    ))}
                </div>

                {/* Error / Info */}
                {error && (
                    <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">
                        {error}
                    </div>
                )}
                {info && (
                    <div className="mb-4 px-4 py-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-blue-400">
                        {info}
                    </div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-3">
                    <div>
                        <label className="block text-xs text-white/50 mb-1.5">Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            autoComplete="email"
                            className="w-full bg-white/[0.06] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 outline-none focus:border-white/20 focus:bg-white/[0.08] transition-all"
                        />
                    </div>

                    <div>
                        <label className="block text-xs text-white/50 mb-1.5">Password</label>
                        <div className="relative">
                            <input
                                type={showPw ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                                className="w-full bg-white/[0.06] border border-white/[0.08] rounded-xl px-4 py-3 pr-10 text-sm text-white placeholder-white/20 outline-none focus:border-white/20 focus:bg-white/[0.08] transition-all"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPw((v) => !v)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/50 transition-colors"
                            >
                                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full mt-2 py-3 px-4 bg-white/10 hover:bg-white/15 border border-white/10 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {loading && <Loader2 size={14} className="animate-spin" />}
                        {mode === 'signin' ? 'Sign in' : 'Create account'}
                    </button>
                </form>

                <p className="mt-6 text-center text-[11px] text-white/25">
                    Press <kbd className="px-1.5 py-0.5 bg-white/[0.08] rounded text-white/40">⌘⇧C</kbd> to toggle the floating overlay
                </p>
            </div>
        </div>
    )
}
