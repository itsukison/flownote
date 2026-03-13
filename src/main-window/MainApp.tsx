import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, NavLink } from 'react-router-dom'
import { FileText, History, Settings, LogOut, MessageSquare, HelpCircle } from 'lucide-react'
import { ja } from '@/i18n/ja'
import AuthPage from './pages/AuthPage'
import DocumentsPage from './pages/DocumentsPage'
import HistoryPage from './pages/HistoryPage'
import SettingsPage from './pages/SettingsPage'
import PromptsPage from './pages/PromptsPage'
import SetupPage from './pages/SetupPage'
import TutorialPage from './pages/TutorialPage'
import HelpPage from './pages/HelpPage'
import { UpdateToast } from '@/components/UpdateToast'
import CommandPalette from '@/components/CommandPalette'

const t = ja

function Sidebar({ user }: { user: any }) {
    const navigate = useNavigate()
    const navItems = [
        { to: '/documents', icon: FileText, label: t.sidebar.documents },
        { to: '/prompts', icon: MessageSquare, label: t.sidebar.prompts },
        { to: '/history', icon: History, label: t.sidebar.history },
        { to: '/help', icon: HelpCircle, label: t.sidebar.help },
        { to: '/settings', icon: Settings, label: t.sidebar.settings },
    ]

    const handleSignOut = async () => {
        await window.electronAPI?.signOut()
        navigate('/auth')
    }

    return (
        <aside className="w-52 flex-none flex flex-col bg-[#111113] border-r border-white/[0.06]">
            {/* Brand */}
            <div className="px-5 py-5 border-b border-white/[0.06] flex items-center gap-0.5">
                <img src="logo.png" alt="Logo" className="w-5 h-5 object-contain" />
                <span className="text-xs font-semibold text-white/60">Flownote</span>
            </div>

            {/* Nav */}
            <nav className="flex-1 p-3 space-y-0.5">
                {navItems.map(({ to, icon: Icon, label }) => (
                    <NavLink
                        key={to}
                        to={to}
                        className={({ isActive }) =>
                            `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${isActive
                                ? 'bg-white/10 text-white font-medium'
                                : 'text-white/40 hover:text-white/70 hover:bg-white/[0.05]'
                            }`
                        }
                    >
                        <Icon size={15} />
                        {label}
                    </NavLink>
                ))}
            </nav>

            {/* User */}
            <div className="p-3 border-t border-white/[0.06]">
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.04]">
                    <div className="w-7 h-7 rounded-full bg-gray-500 flex items-center justify-center text-[11px] font-semibold text-white flex-none">
                        {user?.email?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-xs text-white/70 truncate">{user?.email ?? t.common.unknown}</p>
                    </div>
                    <button onClick={handleSignOut} className="text-white/25 hover:text-white/60 transition-colors" title={t.settings.signOut}>
                        <LogOut size={13} />
                    </button>
                </div>
            </div>
        </aside>
    )
}

export default function MainApp() {
    const navigate = useNavigate()
    const [session, setSession] = useState<any>(undefined)
    const [user, setUser] = useState<any>(null)
    const [isPaletteOpen, setIsPaletteOpen] = useState(false)

    // Cached state for pages
    const [collections, setCollections] = useState<any[]>([])
    const [collectionsLoading, setCollectionsLoading] = useState(true)
    const [questions, setQuestions] = useState<any[]>([])
    const [questionsLoading, setQuestionsLoading] = useState(true)
    const [prompts, setPrompts] = useState<any[]>([])
    const [promptsLoading, setPromptsLoading] = useState(true)
    const [promptsSelectedIds, setPromptsSelectedIds] = useState<{ base?: string; rag?: string }>({})

    // Load cached data on mount
    useEffect(() => {
        loadCollections()
        loadQuestions()
        loadPrompts()

        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault()
                setIsPaletteOpen(prev => !prev)
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [])

    const loadCollections = async () => {
        try {
            const cols = await window.electronAPI.listCollections()
            setCollections(cols)
        } catch (err) {
            console.error('Failed to load collections:', err)
        } finally {
            setCollectionsLoading(false)
        }
    }

    const loadQuestions = async () => {
        try {
            const qs = await window.electronAPI?.getQuestions() ?? []
            setQuestions(qs.slice().reverse())
        } catch (err) {
            console.error('Failed to load questions:', err)
        } finally {
            setQuestionsLoading(false)
        }
    }

    const loadPrompts = async () => {
        try {
            const result = await window.electronAPI?.getPrompts()
            if (result?.success && result.data) {
                setPrompts(result.data)
                setPromptsSelectedIds({
                    base: result.selectedBaseId,
                    rag: result.selectedRagId
                })
            }
        } catch (err) {
            console.error('Failed to load prompts:', err)
        } finally {
            setPromptsLoading(false)
        }
    }

    const refreshCollections = () => {
        setCollectionsLoading(true)
        loadCollections()
    }

    const refreshQuestions = () => {
        setQuestionsLoading(true)
        loadQuestions()
    }

    const refreshPrompts = () => {
        setPromptsLoading(true)
        loadPrompts()
    }

    const clearQuestions = () => {
        window.electronAPI?.clearQuestions()
        setQuestions([])
    }

    useEffect(() => {
        if (!window.electronAPI) {
            setSession(null)
            return
        }
        // Check initial session
        window.electronAPI.getSession().then(({ session }) => {
            setSession(session)
            if (!session) navigate('/auth')
        })
        window.electronAPI.getUser().then(({ user }) => setUser(user))

        // Check if tutorial is needed
        if (session) {
            checkTutorialStatus()
        }

        // Listen for session changes
        const off = window.electronAPI.onSessionChange(({ session }) => {
            setSession(session)
            if (!session) navigate('/auth')
            else {
                window.electronAPI.getUser().then(({ user }) => setUser(user))
                checkTutorialStatus()
            }
        })
        return off
    }, [session])

    const checkTutorialStatus = async () => {
        const setupCompleted = await window.electronAPI?.getSetupCompleted()
        if (!setupCompleted) {
            navigate('/setup')
            return
        }
        const tutorialCompleted = await window.electronAPI?.getTutorialCompleted()
        if (!tutorialCompleted) {
            navigate('/tutorial')
        }
    }

    // Loading
    if (session === undefined) {
        return (
            <div className="flex items-center justify-center h-screen bg-[#0e0e10] text-white/30 text-sm">
                <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-white/20 animate-pulse" />
                    <div className="w-1.5 h-1.5 rounded-full bg-white/20 animate-pulse delay-100" />
                    <div className="w-1.5 h-1.5 rounded-full bg-white/20 animate-pulse delay-200" />
                </div>
            </div>
        )
    }

    return (
        <div className="flex h-screen bg-[#0e0e10] text-white overflow-hidden">
            <Routes>
                <Route path="/auth" element={<AuthPage onAuth={async (s) => {
                    setSession(s)
                    const setupCompleted = await window.electronAPI?.getSetupCompleted()
                    if (!setupCompleted) {
                        navigate('/setup')
                    } else {
                        const tutorialCompleted = await window.electronAPI?.getTutorialCompleted()
                        navigate(tutorialCompleted ? '/documents' : '/tutorial')
                    }
                }} />} />
                <Route
                    path="/setup"
                    element={session ? <SetupPage onComplete={async () => {
                        const tutorialCompleted = await window.electronAPI?.getTutorialCompleted()
                        navigate(tutorialCompleted ? '/documents' : '/tutorial')
                    }} /> : <Navigate to="/auth" replace />}
                />
                <Route
                    path="/tutorial"
                    element={session ? <TutorialPage onComplete={() => navigate('/documents')} /> : <Navigate to="/auth" replace />}
                />
                <Route
                    path="/*"
                    element={
                        session ? (
                            <div className="flex flex-1 overflow-hidden">
                                <Sidebar user={user} />
                                <main className="flex-1 overflow-auto">
                                    <Routes>
                                        <Route path="/" element={<Navigate to="/documents" replace />} />
                                        <Route path="/documents" element={<DocumentsPage collections={collections} loading={collectionsLoading} onRefresh={refreshCollections} />} />
                                        <Route path="/prompts" element={<PromptsPage prompts={prompts} loading={promptsLoading} selectedIds={promptsSelectedIds} onRefresh={refreshPrompts} />} />
                                        <Route path="/history" element={<HistoryPage questions={questions} loading={questionsLoading} onRefresh={refreshQuestions} onClear={clearQuestions} />} />
                                        <Route path="/settings" element={<SettingsPage user={user} />} />
                                        <Route path="/help" element={<HelpPage />} />
                                    </Routes>
                                </main>
                            </div>
                        ) : (
                            <Navigate to="/auth" replace />
                        )
                    }
                />
            </Routes>
            <CommandPalette isOpen={isPaletteOpen} onClose={() => setIsPaletteOpen(false)} />
            <UpdateToast />
        </div>
    )
}
