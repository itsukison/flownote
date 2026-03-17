import { useState } from 'react'
import { KeyRound, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import { ja } from '@/i18n/ja'

const t = ja

interface Props {
  onActivated: (orgName: string) => void
}

export default function ActivationPage({ onActivated }: Props) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) return

    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const result = await window.electronAPI.activateCode(trimmed)
      if (result.success) {
        setSuccess(t.activation.success.replace('{org}', result.orgName || ''))
        setTimeout(() => onActivated(result.orgName || ''), 1200)
      } else {
        const errorKey = result.error || 'unknown'
        const errorMessages: Record<string, string> = {
          invalid_code: t.activation.invalidCode,
          org_inactive: t.activation.orgInactive,
          org_full: t.activation.orgFull,
        }
        setError(errorMessages[errorKey] || t.activation.unknownError)
      }
    } catch (err: any) {
      setError(err.message || t.activation.unknownError)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center h-screen w-full bg-[#0e0e10] text-white">
      <div className="w-full max-w-sm mx-auto px-6">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-4">
            <KeyRound size={22} className="text-zinc-400" />
          </div>
          <h1 className="text-lg font-semibold text-zinc-100">{t.activation.title}</h1>
          <p className="text-sm text-zinc-500 mt-2 leading-relaxed">{t.activation.description}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="FN-XXXXXX"
              maxLength={9}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700 tracking-widest text-center font-mono"
              disabled={loading || !!success}
              autoFocus
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-400 text-xs px-1">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 text-emerald-400 text-xs px-1">
              <CheckCircle size={14} />
              <span>{success}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !code.trim() || !!success}
            className="w-full py-3 bg-zinc-100 text-zinc-900 rounded-xl text-sm font-medium hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              t.activation.activate
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
