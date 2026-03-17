import { useState } from 'react'
import { Mic2, Headphones } from 'lucide-react'
import { ja } from '@/i18n/ja'

const t = ja

interface Props {
    onComplete: () => void
}

export default function SetupPage({ onComplete }: Props) {
    const [step, setStep] = useState(1)

    const handleOpenSettings = () => {
        window.electronAPI?.openSystemAudioSettings()
    }

    const handleSkip = async () => {
        await window.electronAPI?.setSetupCompleted()
        onComplete()
    }

    const handleContinue = async () => {
        await window.electronAPI?.setSetupCompleted()
        onComplete()
    }

    const handleNext = async () => {
        await window.electronAPI?.requestMicPermission()
        setStep(2)
    }

    return (
        <div className="flex flex-col items-center justify-center w-full h-full bg-[#0e0e10]">
            <div className="max-w-sm w-full mx-auto flex flex-col items-center gap-6 py-16 px-8">
                {/* Step indicators */}
                <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full transition-colors ${step === 1 ? 'bg-zinc-400' : 'bg-zinc-700'}`} />
                    <div className={`w-1.5 h-1.5 rounded-full transition-colors ${step === 2 ? 'bg-zinc-400' : 'bg-zinc-700'}`} />
                </div>

                {step === 1 ? (
                    <>
                        <Mic2 size={28} strokeWidth={1.5} className="text-zinc-700" />
                        <div className="text-center space-y-2">
                            <h1 className="text-base font-semibold text-zinc-100">{t.setup.step1Title}</h1>
                            <p className="text-sm text-zinc-400 leading-relaxed">{t.setup.step1Body}</p>
                        </div>
                        <button
                            onClick={handleNext}
                            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl text-sm text-zinc-200 transition-all"
                        >
                            {t.setup.next}
                        </button>
                    </>
                ) : (
                    <>
                        <Headphones size={28} strokeWidth={1.5} className="text-zinc-700" />
                        <div className="text-center space-y-2">
                            <h1 className="text-base font-semibold text-zinc-100">{t.setup.step2Title}</h1>
                            <p className="text-sm text-zinc-400 leading-relaxed">{t.setup.step2Body}</p>
                        </div>

                        {/* Path guide */}
                        <div className="w-full space-y-2">
                            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 text-xs text-zinc-400 font-mono leading-relaxed">
                                <p>{t.setup.step2Path}</p>
                                <p className="text-zinc-500 mt-1">{t.setup.step2PathSub}</p>
                            </div>
                            <p className="text-[10px] text-zinc-600 leading-relaxed px-1">{t.setup.step2Note}</p>
                        </div>

                        <div className="flex flex-col items-center gap-3 w-full">
                            <button
                                onClick={handleOpenSettings}
                                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl text-sm text-zinc-200 transition-all"
                            >
                                {t.setup.openSettings}
                            </button>
                            <button
                                onClick={handleContinue}
                                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl text-sm text-zinc-200 transition-all"
                            >
                                {t.setup.continue}
                            </button>
                            <button
                                onClick={handleSkip}
                                className="text-xs text-zinc-500 hover:text-zinc-400 transition-colors"
                            >
                                {t.setup.skip}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
