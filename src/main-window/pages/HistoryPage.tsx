import { useState, useEffect } from 'react'
import { MessageSquare, Loader2, Clock } from 'lucide-react'

interface Question {
    id: string
    text: string
    timestamp: number
    source?: 'gemini' | 'regex'
}

function timeAgo(ts: number) {
    const diff = Date.now() - ts
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return new Date(ts).toLocaleDateString()
}

export default function HistoryPage() {
    const [questions, setQuestions] = useState<Question[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        window.electronAPI?.getQuestions().then((qs) => {
            setQuestions(qs.slice().reverse()) // most recent first
            setLoading(false)
        }) ?? setLoading(false)
    }, [])

    if (loading) {
        return (
            <div className="flex justify-center items-center h-full">
                <Loader2 size={20} className="animate-spin text-white/20" />
            </div>
        )
    }

    return (
        <div className="max-w-2xl mx-auto px-8 py-8">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-lg font-semibold text-white">History</h1>
                {questions.length > 0 && (
                    <button
                        onClick={() => { window.electronAPI?.clearQuestions(); setQuestions([]) }}
                        className="text-xs text-white/30 hover:text-white/60 transition-colors"
                    >
                        Clear all
                    </button>
                )}
            </div>

            {questions.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-4 text-white/20 py-20">
                    <MessageSquare size={36} strokeWidth={1} />
                    <p className="text-sm">No questions detected yet</p>
                    <p className="text-xs text-white/15">Start listening in the overlay to capture questions</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {questions.map((q) => (
                        <div
                            key={q.id}
                            className="px-4 py-3.5 bg-white/[0.03] border border-white/[0.06] rounded-xl hover:bg-white/[0.05] transition-all"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <p className="text-sm text-white/80 leading-relaxed flex-1">{q.text}</p>
                                {q.source && (
                                    <span className={`flex-none text-[9px] font-medium px-1.5 py-0.5 rounded-full ${q.source === 'gemini' ? 'bg-blue-500/15 text-blue-400' : 'bg-amber-500/15 text-amber-400'
                                        }`}>
                                        {q.source}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-1 mt-2 text-[11px] text-white/25">
                                <Clock size={10} />
                                {timeAgo(q.timestamp)}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
