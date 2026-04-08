import React, { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FolderOpen, Terminal, Mic, Settings, ExternalLink } from 'lucide-react'
import { ja } from '@/i18n/ja'
import { Button } from '@/components/ui/button'
import { assetUrl } from '@/utils/assetUrl'

const t = ja.tutorial

interface TutorialPageProps {
  onComplete: () => void
}

export default function TutorialPage({ onComplete }: TutorialPageProps) {
  const [step, setStep] = useState(0)

  const steps = t.steps

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
    await window.electronAPI?.setOnboardingCompleted()
    onComplete()
  }, [onComplete])

  const currentStep = steps[step]
  const isLast = step === steps.length - 1
  const isVideoStep = step === 1 || step === 2 || step === 3
  const videoSrc =
    step === 1 ? assetUrl('command-slash.mov')
      : step === 2 ? assetUrl('detection.mov')
        : step === 3 ? assetUrl('answering.mov')
          : null

  const renderVisual = () => {
    if (isVideoStep && videoSrc) {
      return (
        <div className="w-full h-full flex items-center justify-center relative bg-black/40 overflow-hidden">
          <video
            src={videoSrc}
            className="w-[105%] h-[105%] object-cover absolute z-10"
            autoPlay
            muted
            loop
            playsInline
          />
          {/* Subtle overlay to blend sharp edges if any */}
          <div className="absolute inset-0 ring-1 ring-inset ring-white/5 pointer-events-none z-20" />
        </div>
      )
    }

    if (step === 0 || step === 6) {
      return (
        <div className="w-full h-full flex items-center justify-center relative bg-black/40 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-tr from-white/5 to-transparent z-0"></div>
          <motion.div
            animate={{ y: [0, -15, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            className="relative z-10 flex items-center justify-center"
          >
            <div className="absolute inset-0 bg-white/20 blur-[100px] rounded-full w-56 h-56 m-auto mix-blend-screen" />
            <img src={assetUrl('app-icon.png')} alt="Flownote" className="w-40 h-40 md:w-52 md:h-52 object-contain drop-shadow-2xl relative z-10" />
          </motion.div>
        </div>
      )
    }

    if (step === 4) {
      return (
        <div className="w-full h-full flex items-center justify-center relative bg-black/40 overflow-hidden group">
          <div className="absolute inset-0 bg-white/5 blur-[120px] w-72 h-72 m-auto rounded-full transition-opacity duration-1000" />
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 100, damping: 20 }}
            className="w-56 h-56 bg-white/5 border border-white/10 rounded-[2rem] flex items-center justify-center shadow-2xl backdrop-blur-md relative z-10 overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent" />
            <FolderOpen className="w-24 h-24 text-zinc-200 drop-shadow-[0_0_20px_rgba(255,255,255,0.3)] relative z-10" />
          </motion.div>
        </div>
      )
    }

    if (step === 5) {
      return (
        <div className="w-full h-full flex items-center justify-center relative bg-black/40 overflow-hidden">
          <div className="absolute inset-0 bg-white/5 blur-[120px] w-72 h-72 m-auto rounded-full transition-opacity duration-1000" />
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 100, damping: 20, delay: 0.1 }}
            className="w-56 h-56 bg-white/5 border border-white/10 rounded-[2rem] flex items-center justify-center shadow-2xl backdrop-blur-md relative z-10 overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent" />
            <Terminal className="w-24 h-24 text-zinc-200 drop-shadow-[0_0_20px_rgba(255,255,255,0.3)] relative z-10" />
          </motion.div>
        </div>
      )
    }

    return null
  }

  return (
    <div className="flex flex-col items-center justify-center w-full h-full bg-[#0e0e10] text-white p-6 md:p-8">
      <div className="max-w-[1000px] w-full h-full min-h-[500px] max-h-[680px] mx-auto flex flex-col relative">
        {/* Step Indicators */}
        <div className="flex justify-center gap-2 mb-8 shrink-0">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-all duration-500 ${
                i === step ? 'bg-white scale-125 w-6' : 'bg-white/20'
              }`}
            />
          ))}
        </div>

        {/* Main Card Container */}
        <div className="flex-1 w-full bg-[#151517] border border-white/10 rounded-[2rem] shadow-2xl overflow-hidden relative flex shadow-black/50">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, scale: 0.98, filter: 'blur(4px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 1.02, filter: 'blur(4px)' }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0 flex flex-col md:flex-row w-full h-full"
            >
              {/* Left Content Pane */}
              <div className="w-full md:w-[45%] flex flex-col justify-between p-8 md:p-12 z-10 relative overflow-y-auto">
                <div className="space-y-6">
                  <div className="inline-flex items-center px-3 py-1 rounded-full bg-white/10 border border-white/10 text-xs font-medium text-zinc-300">
                    Step {step + 1} of {steps.length}
                  </div>
                  
                  <div className="space-y-4">
                    <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-white leading-tight">
                      {currentStep.title}
                    </h1>
                    <p className={`text-zinc-400 leading-relaxed ${step === 2 ? 'text-sm' : 'text-base md:text-lg'}`}>
                      {currentStep.body}
                    </p>
                  </div>

                  {step === 2 && (
                    <div className="flex flex-col gap-4 mt-8">
                      <div className="flex items-center justify-between p-4 rounded-[14px] border border-white/5 bg-white/5 hover:bg-white/10 transition-colors group">
                        <div className="flex items-center gap-4">
                          <div className="p-2 rounded-lg bg-white/10 text-zinc-300">
                            <Mic className="w-5 h-5" />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-semibold text-white">マイク</span>
                            <span className="text-xs text-zinc-400">マイクへのアクセス</span>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => window.electronAPI?.requestMicPermission()}
                          className="rounded-full bg-white text-black hover:bg-zinc-200 font-semibold text-xs px-4 border shadow-sm"
                        >
                          許可する
                        </Button>
                      </div>

                      <div className="flex items-center justify-between p-4 rounded-[14px] border border-white/5 bg-white/5 hover:bg-white/10 transition-colors group">
                        <div className="flex items-center gap-4">
                          <div className="p-2 rounded-lg bg-white/10 text-zinc-300">
                            <Settings className="w-5 h-5" />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-semibold text-white">システム音声</span>
                            <span className="text-xs text-zinc-400">設定から追加</span>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.electronAPI?.openSystemAudioSettings()}
                          className="rounded-full bg-transparent hover:bg-white/10 text-zinc-200 border-white/20 font-semibold text-xs px-4"
                        >
                          開く
                        </Button>
                      </div>
                    </div>
                  )}

                  {isLast && (
                    <div className="flex flex-col gap-3 mt-8">
                      <p className="text-sm text-zinc-400">アプリの詳細な使い方はこちらから確認できます</p>
                      <button 
                        onClick={() => window.electronAPI?.openExternal('https://flownote-jp.com/tutorials')}
                        className="flex items-center justify-between p-4 rounded-[14px] border border-white/5 bg-white/5 hover:bg-white/10 transition-colors group w-full text-left"
                      >
                        <div className="flex items-center gap-4">
                          <div className="p-2 rounded-lg bg-white/10 text-zinc-300 group-hover:bg-white/20 transition-colors">
                            <ExternalLink className="w-5 h-5" />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-semibold text-white">チュートリアルを開く</span>
                            <span className="text-xs text-zinc-400">ブラウザで使い方ガイドを開きます</span>
                          </div>
                        </div>
                      </button>
                    </div>
                  )}
                </div>

                {/* Footer Controls */}
                <div className="flex items-center gap-4 mt-12 pt-6 border-t border-white/10 shrink-0">
                  <Button
                    onClick={handleNext}
                    className="flex-1 py-6 rounded-xl bg-white text-black hover:bg-zinc-200 transition-all text-base font-semibold shadow-[0_4px_20px_rgba(255,255,255,0.15)] hover:shadow-[0_6px_25px_rgba(255,255,255,0.25)]"
                  >
                    {isLast ? t.start : t.next}
                  </Button>
                  
                  {step > 0 && (
                    <Button
                      variant="ghost"
                      onClick={handleBack}
                      className="py-6 px-6 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-colors text-base font-medium"
                    >
                      {t.back}
                    </Button>
                  )}
                </div>
              </div>

              {/* Right Visual Pane */}
              <div className="hidden md:flex w-[55%] border-l border-white/10 bg-[#0a0a0c] relative">
                {renderVisual()}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
