import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, FileText, History, Settings, HelpCircle, PlayCircle, MessageSquare } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ja } from '@/i18n/ja'

const t = ja

interface Command {
  id: string
  label: string
  icon: any
  category: string
  action: () => void
}

export default function CommandPalette({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const commands: Command[] = [
    { id: 'docs', label: t.commandPalette.commands.documents, icon: FileText, category: t.commandPalette.categories.navigation, action: () => navigate('/documents') },
    { id: 'prompts', label: t.commandPalette.commands.prompts, icon: MessageSquare, category: t.commandPalette.categories.navigation, action: () => navigate('/prompts') },
    { id: 'history', label: t.commandPalette.commands.history, icon: History, category: t.commandPalette.categories.navigation, action: () => navigate('/history') },
    { id: 'settings', label: t.commandPalette.commands.settings, icon: Settings, category: t.commandPalette.categories.navigation, action: () => navigate('/settings') },
    { id: 'help', label: t.commandPalette.commands.help, icon: HelpCircle, category: t.commandPalette.categories.navigation, action: () => navigate('/help') },
    { id: 'tutorial', label: t.commandPalette.commands.tutorial, icon: PlayCircle, category: t.commandPalette.categories.actions, action: () => navigate('/tutorial') },
  ]

  const filteredCommands = commands.filter(cmd => 
    cmd.label.toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [isOpen])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => (i + 1) % filteredCommands.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => (i - 1 + filteredCommands.length) % filteredCommands.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filteredCommands[selectedIndex]) {
        filteredCommands[selectedIndex].action()
        onClose()
      }
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh] px-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
          />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            className="relative w-full max-w-xl bg-[#1c1c1e] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden grainy-texture"
          >
            {/* Input */}
            <div className="flex items-center gap-3 px-4 py-4 border-b border-white/[0.06]">
              <Search size={18} className="text-white/20" />
              <input
                ref={inputRef}
                type="text"
                placeholder={t.commandPalette.placeholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 bg-transparent border-none text-white outline-none placeholder:text-white/20 text-base"
              />
            </div>

            {/* List */}
            <div className="max-h-96 overflow-y-auto p-2 scrollbar-none">
              {filteredCommands.length > 0 ? (
                <div>
                  {filteredCommands.map((cmd, i) => {
                    const isFirstInCategory = i === 0 || filteredCommands[i-1].category !== cmd.category
                    return (
                      <React.Fragment key={cmd.id}>
                        {isFirstInCategory && (
                          <div className="px-3 py-2 text-[10px] font-bold text-white/20 tracking-wider uppercase">
                            {cmd.category}
                          </div>
                        )}
                        <button
                          onClick={() => { cmd.action(); onClose() }}
                          onMouseEnter={() => setSelectedIndex(i)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
                            i === selectedIndex ? 'bg-white/10 text-white' : 'text-white/40'
                          }`}
                        >
                          <cmd.icon size={16} className={i === selectedIndex ? 'text-white' : 'text-white/20'} />
                          {cmd.label}
                        </button>
                      </React.Fragment>
                    )
                  })}
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-white/20">
                  {t.commandPalette.empty}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 bg-white/[0.02] border-t border-white/[0.06] flex items-center justify-end gap-4">
              <div className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded-md bg-white/[0.05] border border-white/[0.1] text-[10px] font-mono text-white/40">↑↓</kbd>
                <span className="text-[10px] text-white/20">Navigate</span>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded-md bg-white/[0.05] border border-white/[0.1] text-[10px] font-mono text-white/40">Enter</kbd>
                <span className="text-[10px] text-white/20">Select</span>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded-md bg-white/[0.05] border border-white/[0.1] text-[10px] font-mono text-white/40">Esc</kbd>
                <span className="text-[10px] text-white/20">Close</span>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
