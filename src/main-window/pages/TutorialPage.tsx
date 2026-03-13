import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic2, Headphones, MessageSquare, Check, PlayCircle } from 'lucide-react'
import { ja } from '@/i18n/ja'
import { Button } from '@/components/ui/button'

const t = ja.tutorial

interface TutorialPageProps {
  onComplete: () => void
}

export default function TutorialPage({ onComplete }: TutorialPageProps) {
  const [step, setStep] = useState(0)

  const steps = [
    {
      id: 'welcome',
      icon: <Check size={32} strokeWidth={1.5} className="text-zinc-500" />,
      title: t.welcome.title,
      subtitle: t.welcome.subtitle,
      body: t.welcome.body,
    },
    {
      id: 'audio',
      icon: <MessageSquare size={32} strokeWidth={1.5} className="text-zinc-500" />,
      title: t.audio.title,
      subtitle: t.audio.subtitle,
      body: t.audio.body,
    },
    {
      id: 'live',
      icon: <Mic2 size={32} strokeWidth={1.5} className="text-zinc-500" />,
      title: t.live.title,
      subtitle: t.live.subtitle,
      body: t.live.body,
    },
    {
      id: 'finish',
      icon: <PlayCircle size={32} strokeWidth={1.5} className="text-zinc-500" />,
      title: t.finish.title,
      subtitle: t.finish.subtitle,
      body: t.finish.body,
    },
  ]

  const handleNext = useCallback(() => {
    if (step < steps.length - 1) {
      setStep(step + 1)
    } else {
      handleFinish()
    }
  }, [step, steps.length])

  const handleBack = useCallback(() => {
    if (step > 0) {
      setStep(step - 1)
    }
  }, [step])

  const handleFinish = useCallback(async () => {
    await window.electronAPI?.setTutorialCompleted()
    onComplete()
  }, [onComplete])

  const currentStep = steps[step]

  return (
    <div className="flex flex-col items-center justify-center w-full h-full bg-[#0e0e10] text-white">
      <div className="max-w-md w-full mx-auto px-8 relative">
        {/* Step Indicators */}
        <div className="flex justify-center gap-2 mb-12">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                i === step ? 'bg-zinc-100 scale-125' : 'bg-zinc-800'
              }`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="flex flex-col items-center text-center space-y-6"
          >
            <div className="w-16 h-16 rounded-2xl bg-zinc-900/50 flex items-center justify-center border border-white/[0.05]">
              {currentStep.icon}
            </div>

            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">
                {currentStep.title}
              </h1>
              <p className="text-zinc-500 font-medium text-lg">
                {currentStep.subtitle}
              </p>
            </div>

            <p className="text-zinc-400 leading-relaxed text-sm max-w-[320px]">
              {currentStep.body}
            </p>
          </motion.div>
        </AnimatePresence>

        <div className="mt-16 flex flex-col items-center gap-6">
          <Button
            onClick={handleNext}
            className="w-full max-w-[240px] py-6 rounded-full bg-zinc-100 text-zinc-950 hover:bg-zinc-200 transition-all font-semibold flex items-center justify-center gap-2"
          >
            {step === steps.length - 1 ? t.finish.start : t.next}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Button>

          {step > 0 && (
            <button
              onClick={handleBack}
              className="text-zinc-500 hover:text-zinc-300 transition-colors text-sm font-medium"
            >
              {t.back}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
