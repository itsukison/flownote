import { useState, useEffect, useRef } from 'react'
import { Mic2, Headphones } from 'lucide-react'
import { ja } from '@/i18n/ja'

const t = ja

interface Props {
    onComplete: () => void
}

export default function SetupPage({ onComplete }: Props) {
    const [step, setStep] = useState(1)
    const [permStatus, setPermStatus] = useState<'granted' | 'denied' | 'not-determined' | 'unknown' | null>(null)
    const [settingsOpened, setSettingsOpened] = useState(false)
    const [confirmed, setConfirmed] = useState(false)
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

    // Check permission status once on mount
    useEffect(() => {
        window.electronAPI?.checkSystemAudioPermission().then(setPermStatus)
    }, [])

    // Start polling after "Open System Settings" is clicked
    useEffect(() => {
        if (!settingsOpened) return
        pollRef.current = setInterval(async () => {
            const status = await window.electronAPI?.checkSystemAudioPermission()
            if (status) setPermStatus(status)
            if (status === 'granted') {
                clearInterval(pollRef.current!)
                setConfirmed(true)
            }
        }, 2000)
        return () => { if (pollRef.current) clearInterval(pollRef.current) }
    }, [settingsOpened])

    const handleOpenSettings = () => {
        window.electronAPI?.openSystemAudioSettings()
        setSettingsOpened(true)
    }

    const handleSkip = async () => {
        await window.electronAPI?.setSetupCompleted()
        onComplete()
    }

    const handleContinue = async () => {
        await window.electronAPI?.setSetupCompleted()
        onComplete()
    }

    const handleNext = () => setStep(2)

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

                        {/* Permission status */}
                        <div className="flex items-center gap-2 h-5">
                            {confirmed || permStatus === 'granted' ? (
                                <>
                                    <span className="w-1.5 h-1.5 rounded-full bg-white/60" />
                                    <span className="text-xs text-zinc-400">✓ {t.setup.permissionGranted}</span>
                                </>
                            ) : settingsOpened ? (
                                <>
                                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                                    <span className="text-xs text-zinc-500">{t.permissions.notGranted}</span>
                                </>
                            ) : null}
                        </div>

                        <div className="flex flex-col items-center gap-3 w-full">
                            {confirmed || permStatus === 'granted' ? (
                                <button
                                    onClick={handleContinue}
                                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl text-sm text-zinc-200 transition-all"
                                >
                                    {t.setup.continue}
                                </button>
                            ) : (
                                <button
                                    onClick={handleOpenSettings}
                                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl text-sm text-zinc-200 transition-all"
                                >
                                    {t.setup.openSettings}
                                </button>
                            )}
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
