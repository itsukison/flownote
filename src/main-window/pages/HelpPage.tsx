import React from 'react'
import { motion } from 'framer-motion'
import { HelpCircle, Keyboard, Lightbulb, PlayCircle, ArrowLeft, FileText, Settings, MousePointer2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ja } from '@/i18n/ja'

const t = ja

export default function HelpPage() {
  const navigate = useNavigate()

  const handleRestartTutorial = async () => {
    navigate('/tutorial')
  }

  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0
  const cmdKey = isMac ? '⌘' : 'Ctrl'
  const shiftKey = isMac ? '⇧' : 'Shift'

  return (
    <div className="flex flex-col w-full h-full bg-[#0e0e10] text-white">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-8 py-8">
          <h1 className="text-lg font-semibold text-zinc-100 flex items-center gap-2 mb-8">
            {t.help.title}
          </h1>

          <div className="space-y-16 pb-20 mt-10">
          {/* Keyboard Shortcuts */}
          <section className="space-y-6">
            <h2 className="text-xs font-bold uppercase tracking-widest text-white/30 flex items-center gap-2">
              <Keyboard size={14} />
              {t.help.shortcuts.title}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ShortcutCard 
                label={t.help.shortcuts.overlay}
                keys={[cmdKey, '/']}
              />
              <ShortcutCard 
                label={t.help.shortcuts.palette}
                keys={[cmdKey, 'K']}
              />
              <ShortcutCard 
                label={t.help.shortcuts.settings}
                keys={[cmdKey, shiftKey, '/']}
              />
            </div>
          </section>

          {/* Usage Tips */}
          <section className="space-y-8 -mb-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-white/30 flex items-center gap-2">
              <Lightbulb size={14} />
              {t.help.tips.title}
            </h2>
            <div className="flex flex-col gap-12">
              <TipCard 
                icon={<FileText size={14} className="text-white/40" />}
                title={t.help.tips.tip1.title} 
                description={t.help.tips.tip1.description}
              />
              <TipCard 
                icon={<MousePointer2 size={14} className="text-white/40" />}
                title={t.help.tips.tip2.title} 
                description={t.help.tips.tip2.description}
              />
              <TipCard 
                icon={<Settings size={14} className="text-white/40" />}
                title={t.help.tips.tip3.title} 
                description={t.help.tips.tip3.description}
              />
            </div>
          </section>

          {/* Tutorial Reset */}
          <section className="pt-12 border-t border-white/[0.04]">
            <div className="p-8 rounded-3xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-between gap-6">
              <div className="space-y-2">
                <h3 className="font-medium text-white/90">{t.help.tutorial.title}</h3>
                <p className="text-sm text-white/40 leading-relaxed max-w-md">Flownoteの主要な機能と使い方の流れを、ガイド付きツアーでもう一度確認できます。</p>
              </div>
              <Button 
                variant="outline" 
                onClick={handleRestartTutorial}
                className="h-11 px-6 rounded-2xl flex items-center gap-2 bg-white/5 border-white/10 hover:bg-white/10 transition-all text-white font-medium shadow-xl"
              >
                <PlayCircle size={18} />
                {t.help.tutorial.restart}
              </Button>
            </div>
          </section>
          </div>
        </div>
      </div>
    </div>
  )
}

function ShortcutCard({ label, keys }: { label: string, keys: string[] }) {
  return (
    <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.05] flex items-center justify-between group hover:bg-white/[0.04] transition-all duration-300">
      <span className="text-sm text-white/60 group-hover:text-white/80 transition-colors font-medium">{label}</span>
      <div className="flex items-center gap-1.5">
        {keys.map((k, i) => (
          <React.Fragment key={i}>
            <kbd className="h-8 min-w-[32px] px-2 flex items-center justify-center bg-[#1a1a1c] border-b-2 border-black rounded-lg text-white/90 font-mono text-[11px] shadow-lg group-hover:translate-y-[1px] group-hover:border-b-0 transition-all duration-200">
              {k}
            </kbd>
            {i < keys.length - 1 && <span className="text-white/10 text-[10px]">&</span>}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

function TipCard({ title, description, icon }: { title: string, description: string, icon: React.ReactNode }) {
  return (
    <div className="flex gap-8 group max-w-3xl">
      <div className="shrink-0 w-4 h-4 mt-1 flex items-center justify-center text-white/10 group-hover:text-white/40 transition-all">
        {icon}
      </div>
      <div className="space-y-3 pt-0.5">
        <h3 className="text-base font-semibold text-white/90 tracking-tight group-hover:text-white transition-colors">{title}</h3>
        <p className="text-[14px] text-white/40 leading-[1.6] font-light text-justify">{description}</p>
      </div>
    </div>
  )
}
