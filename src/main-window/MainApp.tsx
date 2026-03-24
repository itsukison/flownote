import { useEffect, useState } from 'react'
import { assetUrl } from '@/utils/assetUrl'
const logoUrl = assetUrl('logo.png')
import { Routes, Route, Navigate, useNavigate, NavLink } from 'react-router-dom'
import { FileText, History, Settings, LogOut, MessageSquare, HelpCircle, ChevronLeft, ChevronRight, AlignJustify } from 'lucide-react'
import { ja } from '@/i18n/ja'
import AuthPage from './pages/AuthPage'
import ActivationPage from './pages/ActivationPage'
import DocumentsPage from './pages/DocumentsPage'
import HistoryPage from './pages/history'
import SettingsPage from './pages/SettingsPage'
import PromptsPage from './pages/PromptsPage'
import TutorialPage from './pages/TutorialPage'
import HelpPage from './pages/HelpPage'
import { UpdateToast } from '@/components/UpdateToast'
import CommandPalette from '@/components/CommandPalette'

const t = ja

function Sidebar({ user, collapsed, onToggle }: { user: any; collapsed: boolean; onToggle: () => void }) {
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
        <aside
            style={{
                width: collapsed ? 0 : 208,
                transition: 'width 250ms ease',
                overflow: 'hidden',
                flexShrink: 0,
            }}
            className="flex flex-col bg-[#111113] border-r border-white/[0.06]"
        >
            <div style={{ width: 208 }} className="flex flex-col flex-1">
                {/* Brand */}
                <div className="px-6 py-6 flex items-center gap-2">
                    <img src={logoUrl} alt="Logo" className="w-7 h-7 object-contain" />
                    <span className="text-base font-bold text-white/90">Flownote</span>
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
            </div>
        </aside>
    )
}

const FullPageLoader = ({
    isFadingOut = false,
    className = ""
}: {
    isFadingOut?: boolean
    className?: string
}) => (
    <div
        className={`flex items-center justify-center h-screen w-screen bg-[#0e0e10] text-white/30 text-sm transition-opacity duration-700 ${isFadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'} ${className}`}
    >
        <img
            src={logoUrl}
            alt="Logo"
            className="w-16 h-16 object-contain animate-pulse opacity-90"
        />
    </div>
)

export default function MainApp() {
    const navigate = useNavigate()
    const [session, setSession] = useState<any>(undefined)
    const [activationChecked, setActivationChecked] = useState(false)
    const [user, setUser] = useState<any>(null)
    const [isPaletteOpen, setIsPaletteOpen] = useState(false)
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
        try { return localStorage.getItem('sidebarCollapsed') === 'true' } catch { return false }
    })

    const toggleSidebar = () => setSidebarCollapsed(prev => {
        const next = !prev
        try { localStorage.setItem('sidebarCollapsed', String(next)) } catch { /* noop */ }
        return next
    })

    // Cached state for pages
    const [collections, setCollections] = useState<any[]>([])
    const [collectionsLoading, setCollectionsLoading] = useState(true)
    const [prompts, setPrompts] = useState<any[]>([])
    const [promptsLoading, setPromptsLoading] = useState(true)
    const [promptsSelectedIds, setPromptsSelectedIds] = useState<{ base?: string; rag?: string }>({})

    // Load cached data on mount
    useEffect(() => {
        loadCollections()
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

    const refreshPrompts = () => {
        setPromptsLoading(true)
        loadPrompts()
    }

    const checkOnboardingStatus = async () => {
        const membership = await window.electronAPI?.getOrgMembership()
        if (!membership) {
            navigate('/activation')
            setActivationChecked(true)
            return
        }
        const onboardingCompleted = await window.electronAPI?.getOnboardingCompleted()
        navigate(onboardingCompleted ? '/documents' : '/tutorial')
        setActivationChecked(true)
    }

    // Minimum splash screen duration
    const [splashMinTimePassed, setSplashMinTimePassed] = useState(false)
    const [showLoaderOverlay, setShowLoaderOverlay] = useState(true)
    const [fadeLoader, setFadeLoader] = useState(false)

    useEffect(() => {
        const timer = setTimeout(() => {
            setSplashMinTimePassed(true)
        }, 1200) // Minimum 1.2s splash duration
        return () => clearTimeout(timer)
    }, [])

    useEffect(() => {
        if (!window.electronAPI) {
            setSession(null)
            setActivationChecked(true)
            return
        }

        window.electronAPI.getSession().then(async ({ session }) => {
            setSession(session)
            if (!session) {
                navigate('/auth')
                setActivationChecked(true)
            } else {
                await window.electronAPI.getUser().then(({ user }) => setUser(user))
                await checkOnboardingStatus()
            }
        })

        return window.electronAPI.onSessionChange(({ session }) => {
            setSession(session)
            if (!session) {
                navigate('/auth')
            } else {
                window.electronAPI.getUser().then(({ user }) => setUser(user))
                checkOnboardingStatus()
            }
        })
    }, [])

    // Fade out logic
    const isReady = session !== undefined && activationChecked && splashMinTimePassed

    useEffect(() => {
        if (isReady) {
            setFadeLoader(true)
            const t = setTimeout(() => setShowLoaderOverlay(false), 700) // duration-700
            return () => clearTimeout(t)
        }
    }, [isReady])

    // Render early loader if completely completely not ready to even render children
    if (!showLoaderOverlay && !isReady) {
        return <FullPageLoader />
    }

    return (
        <>
            <div className="flex h-screen bg-[#0e0e10] text-white overflow-hidden">
                <Routes>
                    <Route path="/auth" element={<AuthPage onAuth={(s) => {
                        setSession(s)
                        refreshCollections()
                        refreshPrompts()
                        checkOnboardingStatus()
                    }} />} />
                    <Route
                        path="/activation"
                        element={session ? <ActivationPage onActivated={() => {
                            refreshCollections()
                            refreshPrompts()
                            checkOnboardingStatus()
                        }} /> : <Navigate to="/auth" replace />}
                    />
                    <Route
                        path="/setup"
                        element={session ? <Navigate to="/tutorial" replace /> : <Navigate to="/auth" replace />}
                    />
                    <Route
                        path="/tutorial"
                        element={session ? <TutorialPage onComplete={() => navigate('/documents')} /> : <Navigate to="/auth" replace />}
                    />
                    <Route
                        path="/*"
                        element={
                            session ? (
                                <div className="flex flex-1 overflow-hidden relative">
                                    <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={toggleSidebar} />

                                    {/* Floating toggle button */}
                                    <button
                                        onClick={toggleSidebar}
                                        style={{
                                            position: 'absolute',
                                            top: 16,
                                            left: sidebarCollapsed ? 12 : 172,
                                            transition: 'left 250ms ease',
                                            zIndex: 30,
                                        }}
                                        className="w-7 h-7 flex items-center justify-center rounded-lg text-white/30 hover:text-white/70 hover:bg-white/[0.07] transition-colors"
                                        title={sidebarCollapsed ? 'Open sidebar' : 'Close sidebar'}
                                    >
                                        {sidebarCollapsed ? <AlignJustify size={14} /> : <ChevronLeft size={14} />}
                                    </button>

                                    <main className="flex-1 overflow-auto">
                                        <Routes>
                                            <Route path="/" element={<Navigate to="/documents" replace />} />
                                            <Route path="/documents" element={<DocumentsPage collections={collections} loading={collectionsLoading} onRefresh={refreshCollections} />} />
                                            <Route path="/prompts" element={<PromptsPage prompts={prompts} loading={promptsLoading} selectedIds={promptsSelectedIds} onRefresh={refreshPrompts} />} />
                                            <Route path="/history" element={<HistoryPage />} />
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

            {/* Fading overlay on top */}
            {showLoaderOverlay && (
                <div className="fixed inset-0 z-50 pointer-events-none">
                    <FullPageLoader isFadingOut={fadeLoader} className="pointer-events-auto" />
                </div>
            )}
        </>
    )
}
