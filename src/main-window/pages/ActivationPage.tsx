import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { assetUrl } from '@/utils/assetUrl'
import { PlanCards, BusinessModal, EnterpriseModal } from '@/components/PlanSelection'

const logoUrl = assetUrl('logo.png')

interface Props {
  onActivated: (orgName: string) => void
}

export default function ActivationPage({ onActivated }: Props) {
  const navigate = useNavigate()
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [businessModalOpen, setBusinessModalOpen] = useState(false)
  const [enterpriseModalOpen, setEnterpriseModalOpen] = useState(false)

  const handleProUpgrade = async () => {
    setCheckoutLoading(true)
    const result = await window.electronAPI?.openCheckout('pro')
    setCheckoutLoading(false)
    if (!result?.success) {
      console.error('Checkout failed:', result?.error)
    }
  }

  const handleActivated = () => {
    onActivated('')
  }

  return (
    <div className="flex items-center justify-center h-screen w-full bg-[#0e0e10] text-white">
      <div className="w-full max-w-lg mx-auto px-6">
        <div className="text-center mb-8">
          <img src={logoUrl} alt="Logo" className="w-10 h-10 object-contain mx-auto mb-4 opacity-80" />
          <h1 className="text-lg font-semibold text-zinc-100">無料クレジットを使い切りました</h1>
          <p className="text-sm text-zinc-500 mt-2 leading-relaxed max-w-sm mx-auto">
            引き続きFlownoteをご利用いただくには、プランを選択してください。
          </p>
        </div>

        <PlanCards
          onProClick={handleProUpgrade}
          onBusinessClick={() => setBusinessModalOpen(true)}
          onEnterpriseClick={() => setEnterpriseModalOpen(true)}
          checkoutLoading={checkoutLoading}
        />

        <button
          type="button"
          onClick={() => navigate('/auth')}
          className="w-full mt-6 py-2.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors text-center"
        >
          別のアカウントでログイン
        </button>

        <BusinessModal
          open={businessModalOpen}
          onClose={() => setBusinessModalOpen(false)}
          onActivated={handleActivated}
        />
        <EnterpriseModal
          open={enterpriseModalOpen}
          onClose={() => setEnterpriseModalOpen(false)}
        />
      </div>
    </div>
  )
}
