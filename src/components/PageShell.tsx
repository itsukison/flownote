import React from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── PageHeader ────────────────────────────────────────────────────────────
// Consistent h1 across all main-window pages.
export function PageHeader({
    title,
    children,
}: {
    title: string
    children?: React.ReactNode
}) {
    return (
        <div className="flex items-center justify-between mb-8">
            <h1 className="text-2xl font-semibold text-white/90 tracking-tight">{title}</h1>
            {children && <div className="flex items-center gap-2">{children}</div>}
        </div>
    )
}

// ── SectionHeader ─────────────────────────────────────────────────────────
// Small uppercase label for subsection groupings (e.g. "Base Prompts", "RAG Prompts").
export function SectionHeader({
    title,
    children,
    className = '',
}: {
    title: string
    children?: React.ReactNode
    className?: string
}) {
    return (
        <div className={cn('flex items-center justify-between mb-4', className)}>
            <h2 className="text-[11px] font-medium text-white/30 uppercase tracking-widest">{title}</h2>
            {children && <div className="flex items-center gap-2">{children}</div>}
        </div>
    )
}

// ── SectionTitle ──────────────────────────────────────────────────────────
// Prominent heading for major page sections (e.g. "System Prompts", "Quick Prompts").
// Use this above SectionHeader when you need a two-level hierarchy on one page.
export function SectionTitle({
    title,
    children,
    className = '',
}: {
    title: string
    children?: React.ReactNode
    className?: string
}) {
    return (
        <div className={cn('flex items-center justify-between', className)}>
            <h2 className="text-sm font-semibold text-white/80 tracking-tight">{title}</h2>
            {children && <div className="flex items-center gap-2">{children}</div>}
        </div>
    )
}

// ── EmptyState ────────────────────────────────────────────────────────────
// Icon + title + optional hint, centered in the available space.
export function EmptyState({
    icon,
    title,
    hint,
}: {
    icon: React.ReactNode
    title: string
    hint?: string
}) {
    return (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 py-20 text-center">
            <div className="text-white/15">{icon}</div>
            <div>
                <p className="text-sm text-white/40 font-medium">{title}</p>
                {hint && <p className="text-xs text-white/25 mt-1">{hint}</p>}
            </div>
        </div>
    )
}

// ── InlineLoader ──────────────────────────────────────────────────────────
// Centered spinner used while a full page section is loading.
export function InlineLoader({ className = '' }: { className?: string }) {
    return (
        <div className={`flex items-center justify-center ${className}`}>
            <Loader2 size={18} className="animate-spin text-white/20" />
        </div>
    )
}

// ── SharingTabs ───────────────────────────────────────────────────────────
// Underline-style Mine / Team filter tabs. Used in Documents, Prompts, Workflow.
// onChange accepts both plain callbacks and React setState dispatchers.
export function SharingTabs<T extends string>({
    tabs,
    active,
    onChange,
    className = '',
}: {
    tabs: { key: T; label: string }[]
    active: T
    onChange: ((key: T) => void) | React.Dispatch<React.SetStateAction<T>>
    className?: string
}) {
    return (
        <div className={`flex items-center gap-6 mb-6 border-b border-white/[0.06] ${className}`}>
            {tabs.map(({ key, label }) => (
                <button
                    key={key}
                    onClick={() => onChange(key)}
                    className={`pb-2.5 text-xs font-medium transition-colors border-b-[1.5px] -mb-px ${
                        active === key
                            ? 'border-white/60 text-white/80'
                            : 'border-transparent text-white/30 hover:text-white/55'
                    }`}
                >
                    {label}
                </button>
            ))}
        </div>
    )
}
