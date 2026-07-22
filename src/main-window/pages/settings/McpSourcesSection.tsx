import { useState, useEffect } from 'react'
import { Plus, Trash2, Loader2, CheckCircle2, Globe } from 'lucide-react'
import { ja } from '@/i18n/ja'
import { SectionHeader } from '@/components/PageShell'

const t = ja.settings.mcp

export default function McpSourcesSection() {
    const [sources, setSources] = useState<McpSource[]>([])
    const [addOpen, setAddOpen] = useState(false)
    const [name, setName] = useState('')
    const [url, setUrl] = useState('')
    const [token, setToken] = useState('')
    const [adding, setAdding] = useState(false)
    const [addError, setAddError] = useState<string | null>(null)
    const [testingId, setTestingId] = useState<string | null>(null)
    const [testResult, setTestResult] = useState<{ id: string; ok: boolean; message: string } | null>(null)
    const [toolsById, setToolsById] = useState<Record<string, McpTool[]>>({})

    const refresh = () => { window.electronAPI?.mcpListSources().then(setSources) }
    useEffect(() => { refresh() }, [])

    const handleAdd = async () => {
        if (!url.trim() || adding) return
        setAdding(true)
        setAddError(null)
        const result = await window.electronAPI?.mcpAddSource({ name, url, token: token || undefined })
        setAdding(false)
        if (result?.success && result.source) {
            setToolsById((prev) => ({ ...prev, [result.source!.id]: result.tools ?? [] }))
            setName(''); setUrl(''); setToken(''); setAddOpen(false)
            refresh()
        } else {
            setAddError(result?.error || 'エラーが発生しました')
        }
    }

    const handleTest = async (id: string) => {
        setTestingId(id)
        setTestResult(null)
        const result = await window.electronAPI?.mcpTestSource(id)
        setTestingId(null)
        if (result?.success) {
            setToolsById((prev) => ({ ...prev, [id]: result.tools ?? [] }))
            setTestResult({ id, ok: true, message: t.testOk })
        } else {
            setTestResult({ id, ok: false, message: result?.error || 'エラー' })
        }
    }

    const handleToggle = async (source: McpSource) => {
        setSources((prev) => prev.map((s) => (s.id === source.id ? { ...s, enabled: !s.enabled } : s)))
        const result = await window.electronAPI?.mcpUpdateSource(source.id, { enabled: !source.enabled })
        if (!result?.success) refresh()
    }

    const handleToolChange = async (id: string, searchTool: string) => {
        const tool = toolsById[id]?.find((x) => x.name === searchTool)
        const props = tool?.inputSchema?.properties ?? {}
        const queryArg = props.query ? 'query' : props.q ? 'q' : Object.keys(props).find((k) => props[k]?.type === 'string')
        await window.electronAPI?.mcpUpdateSource(id, { searchTool, ...(queryArg ? { queryArg } : {}) })
        refresh()
    }

    const handleRemove = async (source: McpSource) => {
        if (!confirm(t.confirmRemove.replace('{name}', source.name))) return
        await window.electronAPI?.mcpRemoveSource(source.id)
        refresh()
    }

    const inputCls = 'w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white/90 placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors'

    return (
        <section className="space-y-1 mb-10">
            <SectionHeader title={t.title}>
                {!addOpen && (
                    <button
                        onClick={() => { setAddOpen(true); setAddError(null) }}
                        className="flex items-center gap-1 text-xs text-white/40 hover:text-white/80 transition-colors"
                    >
                        <Plus size={12} /> {t.addServer}
                    </button>
                )}
            </SectionHeader>
            <p className="text-xs text-white/40 leading-relaxed pb-2">{t.description}</p>

            {addOpen && (
                <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 -mx-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <label className="text-[10px] text-white/40">{t.name}</label>
                            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.namePlaceholder} className={inputCls} />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] text-white/40">{t.url}</label>
                            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t.urlPlaceholder} className={inputCls} />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] text-white/40">{t.token}</label>
                        <input value={token} onChange={(e) => setToken(e.target.value)} placeholder={t.tokenPlaceholder} type="password" className={inputCls} />
                    </div>
                    {addError && <p className="text-[11px] text-white/40">{addError}</p>}
                    <div className="flex gap-2 justify-end">
                        <button
                            onClick={() => setAddOpen(false)}
                            className="px-3 py-1.5 text-xs font-medium text-white/40 hover:text-white/80 hover:bg-white/[0.05] rounded-lg transition-colors"
                        >
                            {t.cancel}
                        </button>
                        <button
                            onClick={handleAdd}
                            disabled={adding || !url.trim()}
                            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white/90 bg-white/10 hover:bg-white/[0.15] border border-white/10 rounded-lg transition-colors disabled:opacity-50"
                        >
                            {adding && <Loader2 size={11} className="animate-spin" />}
                            {adding ? t.connecting : t.connect}
                        </button>
                    </div>
                </div>
            )}

            {!sources.length && !addOpen && (
                <p className="text-xs text-white/40 py-2 italic">{t.noSources}</p>
            )}

            {sources.map((source) => {
                const tools = toolsById[source.id]
                const result = testResult?.id === source.id ? testResult : null
                return (
                    <div key={source.id} className="py-3 -mx-3 px-3 hover:bg-white/[0.03] rounded-lg transition-colors space-y-2">
                        <div className="flex justify-between items-center gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                                <Globe size={13} className="text-white/50 shrink-0" />
                                <div className="min-w-0">
                                    <p className="text-sm text-white/80 truncate">{source.name}</p>
                                    <p className="text-[10px] text-white/40 font-mono truncate">
                                        {source.url}
                                        {source.hasToken && <span className="ml-2 text-white/40">· {t.tokenStored}</span>}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    onClick={() => handleTest(source.id)}
                                    disabled={testingId === source.id}
                                    className="text-[11px] text-white/40 hover:text-white/80 transition-colors"
                                >
                                    {testingId === source.id ? t.testing : t.test}
                                </button>
                                <button
                                    onClick={() => handleToggle(source)}
                                    className={`w-9 h-5 rounded-full relative transition-colors flex-none ${source.enabled ? 'bg-green-500/70' : 'bg-zinc-700'}`}
                                >
                                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${source.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                                </button>
                                <button onClick={() => handleRemove(source)} className="text-white/40 hover:text-white/80 transition-colors">
                                    <Trash2 size={13} />
                                </button>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 pl-[21px] text-[10px]">
                            <span className="text-white/40">{t.searchTool}:</span>
                            {tools && tools.length > 1 ? (
                                <select
                                    value={source.searchTool}
                                    onChange={(e) => handleToolChange(source.id, e.target.value)}
                                    className="bg-white/[0.04] border border-white/[0.08] rounded-md px-1.5 py-0.5 text-[10px] text-white/80 focus:outline-none"
                                >
                                    {tools.map((tool) => (
                                        <option key={tool.name} value={tool.name}>{tool.name}</option>
                                    ))}
                                </select>
                            ) : (
                                <span className="text-white/40 font-mono">{source.searchTool}</span>
                            )}
                            {result && (
                                <span className="flex items-center gap-1 text-white/40">
                                    {result.ok && <CheckCircle2 size={11} />}
                                    {result.message}
                                </span>
                            )}
                        </div>
                    </div>
                )
            })}
        </section>
    )
}
