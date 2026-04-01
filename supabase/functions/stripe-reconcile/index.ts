import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

async function stripeGet(path: string): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  })
  return res.json()
}

Deno.serve(async (req: Request) => {
  // Verify this is called by cron or authorized
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    // 1. Find all profiles with a stripe_customer_id and active/past_due/canceled status
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, stripe_customer_id, plan, subscription_status, current_period_end')
      .not('stripe_customer_id', 'is', null)
      .neq('subscription_status', 'none')

    if (error) {
      console.error('Failed to fetch profiles:', error)
      return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    }

    let fixed = 0
    let reverted = 0

    for (const profile of profiles ?? []) {
      // 2. Check if canceled subscriptions have passed their period end
      if (profile.subscription_status === 'canceled' && profile.current_period_end) {
        if (new Date() > new Date(profile.current_period_end)) {
          // Revert to free
          await supabase
            .from('profiles')
            .update({
              plan: 'free',
              subscription_status: 'none',
              current_period_start: null,
              current_period_end: null,
              current_period_usage: 0,
            })
            .eq('id', profile.id)
          reverted++
          continue
        }
      }

      // 3. For active/past_due, verify against Stripe
      if (profile.subscription_status === 'active' || profile.subscription_status === 'past_due') {
        const customerData = await stripeGet(
          `/subscriptions?customer=${profile.stripe_customer_id}&status=all&limit=1`
        )

        if (!customerData.data || customerData.data.length === 0) {
          // No subscription in Stripe — revert to free
          await supabase
            .from('profiles')
            .update({
              plan: 'free',
              subscription_status: 'none',
              current_period_start: null,
              current_period_end: null,
              current_period_usage: 0,
            })
            .eq('id', profile.id)
          fixed++
          continue
        }

        const sub = customerData.data[0]
        const stripeStatus = sub.status === 'active' ? 'active'
          : sub.status === 'past_due' ? 'past_due'
          : sub.status === 'canceled' ? 'canceled'
          : 'none'

        // Fix drift
        if (stripeStatus !== profile.subscription_status) {
          const periodStart = new Date(sub.current_period_start * 1000).toISOString()
          const periodEnd = new Date(sub.current_period_end * 1000).toISOString()

          await supabase
            .from('profiles')
            .update({
              subscription_status: stripeStatus,
              current_period_start: periodStart,
              current_period_end: periodEnd,
              ...(stripeStatus === 'none' ? { plan: 'free', current_period_usage: 0 } : {}),
            })
            .eq('id', profile.id)
          fixed++
        }
      }
    }

    return new Response(
      JSON.stringify({
        processed: profiles?.length ?? 0,
        fixed,
        reverted,
        timestamp: new Date().toISOString(),
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('Reconciliation error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
