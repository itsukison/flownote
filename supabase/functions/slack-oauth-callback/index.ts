import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SLACK_CLIENT_ID = Deno.env.get('SLACK_CLIENT_ID') ?? ''
const SLACK_CLIENT_SECRET = Deno.env.get('SLACK_CLIENT_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function textPage(title: string, subtitle: string): string {
  return title + '\n\n' + subtitle + '\n\nThis window can be closed.'
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const stateToken = url.searchParams.get('state')

  if (!code || !stateToken) {
    return new Response(textPage('Error', 'Missing required parameters.'), { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: stateRow, error: stateError } = await supabase
    .from('oauth_states')
    .select('user_id, created_at')
    .eq('state_token', stateToken)
    .eq('provider', 'slack')
    .single()

  if (stateError || !stateRow) {
    return new Response(textPage('Authentication Error', 'Invalid or expired request. Please try again.'), { status: 403 })
  }

  const createdAt = new Date(stateRow.created_at).getTime()
  if (Date.now() - createdAt > 10 * 60 * 1000) {
    await supabase.from('oauth_states').delete().eq('state_token', stateToken)
    return new Response(textPage('Expired', 'This request has expired. Please try again.'), { status: 403 })
  }

  await supabase.from('oauth_states').delete().eq('state_token', stateToken)

  const redirectUri = SUPABASE_URL + '/functions/v1/slack-oauth-callback'
  const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: SLACK_CLIENT_ID,
      client_secret: SLACK_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  })

  const tokenData = await tokenRes.json()

  if (!tokenData.ok) {
    console.error('[SlackOAuth] Token exchange failed:', tokenData.error)
    return new Response(textPage('Slack Auth Failed', tokenData.error || 'Unknown error'), { status: 400 })
  }

  const config = {
    access_token: tokenData.access_token,
    team_name: tokenData.team?.name ?? '',
    team_id: tokenData.team?.id ?? '',
    bot_user_id: tokenData.bot_user_id ?? '',
    scope: tokenData.scope ?? '',
  }

  const { error: upsertError } = await supabase
    .from('user_integrations')
    .upsert(
      {
        user_id: stateRow.user_id,
        provider: 'slack',
        config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' }
    )

  if (upsertError) {
    console.error('[SlackOAuth] Upsert error:', upsertError)
    return new Response(textPage('Save Error', 'Failed to save data. Please try again.'), { status: 500 })
  }

  return new Response(textPage('Slack Connected', 'Flownote has been successfully connected to Slack.'), { status: 200 })
})
