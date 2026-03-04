import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, NavLink } from 'react-router-dom'
import { FileText, History, Settings, LogOut, ChevronRight } from 'lucide-react'
import AuthPage from './pages/AuthPage'
import DocumentsPage from './pages/DocumentsPage'
import HistoryPage from './pages/HistoryPage'
import SettingsPage from './pages/SettingsPage'

function Sidebar({ user }: { user: any }) {
    const navigate = useNavigate()
    const navItems = [
        { to: '/documents', icon: FileText, label: 'Documents' },
        { to: '/history', icon: History, label: 'History' },
        { to: '/settings', icon: Settings, label: 'Settings' },
    ]

    const handleSignOut = async () => {
        await window.electronAPI?.signOut()
        navigate('/auth')
    }

    return (
        <aside className="w-52 flex-none flex flex-col bg-[#111113] border-r border-white/[0.06]">
            {/* Brand */}
            <div className="px-5 py-5 border-b border-white/[0.06]">
                <span className="text-xs font-bold tracking-widest uppercase text-white/50">FlowNote</span>
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
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-[11px] font-semibold text-white flex-none">
                        {user?.email?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-xs text-white/70 truncate">{user?.email ?? 'Unknown'}</p>
                    </div>
                    <button onClick={handleSignOut} className="text-white/25 hover:text-white/60 transition-colors" title="Sign out">
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

        // Listen for session changes
        const off = window.electronAPI.onSessionChange(({ session }) => {
            setSession(session)
            if (!session) navigate('/auth')
            else window.electronAPI.getUser().then(({ user }) => setUser(user))
        })
        return off
    }, [])

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
                <Route path="/auth" element={<AuthPage onAuth={(s) => { setSession(s); navigate('/documents') }} />} />
                <Route
                    path="/*"
                    element={
                        session ? (
                            <div className="flex flex-1 overflow-hidden">
                                <Sidebar user={user} />
                                <main className="flex-1 overflow-auto">
                                    <Routes>
                                        <Route path="/" element={<Navigate to="/documents" replace />} />
                                        <Route path="/documents" element={<DocumentsPage />} />
                                        <Route path="/history" element={<HistoryPage />} />
                                        <Route path="/settings" element={<SettingsPage user={user} />} />
                                    </Routes>
                                </main>
                            </div>
                        ) : (
                            <Navigate to="/auth" replace />
                        )
                    }
                />
            </Routes>
        </div>
    )
}
