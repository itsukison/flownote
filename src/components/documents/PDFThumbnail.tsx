'use client'

import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { FileText } from 'lucide-react'

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

interface PDFThumbnailProps {
    url: string
    className?: string
    targetHeight?: number
}

export function PDFThumbnail({ url, className, targetHeight = 180 }: PDFThumbnailProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)

    useEffect(() => {
        let cancelled = false

        async function renderPDF() {
            if (!canvasRef.current) return

            try {
                setLoading(true)
                setError(false)

                const response = await fetch(url)
                if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status}`)
                const buffer = await response.arrayBuffer()
                const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) })
                const pdf = await Promise.race([
                    loadingTask.promise,
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('PDF load timeout')), 10000)
                    )
                ]) as pdfjsLib.PDFDocumentProxy

                if (cancelled) return

                const page = await pdf.getPage(1)
                if (cancelled) return

                const viewport = page.getViewport({ scale: 1 })
                const scale = targetHeight / viewport.height
                const scaledViewport = page.getViewport({ scale })

                const canvas = canvasRef.current
                const context = canvas.getContext('2d')
                if (!context) return

                canvas.height = scaledViewport.height
                canvas.width = scaledViewport.width

                await page.render({
                    canvas: canvas,
                    canvasContext: context,
                    viewport: scaledViewport,
                }).promise

                setLoading(false)
            } catch (err) {
                console.warn('PDF thumbnail render failed (non-critical):', err)
                if (!cancelled) {
                    setError(true)
                    setLoading(false)
                }
            }
        }

        renderPDF()

        return () => {
            cancelled = true
        }
    }, [url])

    if (error) {
        return (
            <div className={`flex items-center justify-center bg-[#1b1b1e] ${className}`}>
                <FileText className="w-10 h-10 text-white/30" />
            </div>
        )
    }

    return (
        <div className={`relative ${className}`}>
            {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#1b1b1e]">
                    <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
            )}
            <canvas
                ref={canvasRef}
                className={`w-full h-full object-cover ${loading ? 'opacity-0' : 'opacity-90 hover:opacity-100'} transition-opacity`}
            />
        </div>
    )
}
