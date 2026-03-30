import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SLACK_CLIENT_ID = Deno.env.get('SLACK_CLIENT_ID') ?? ''
const SLACK_CLIENT_SECRET = Deno.env.get('SLACK_CLIENT_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const HTML_SUCCESS = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Flownote</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0e0e10;color:#fff}
.card{text-align:center;padding:40px;border-radius:16px;background:#1a1a1e}
h2{margin:0 0 8px}p{color:#888;margin:0}</style></head>
<body><div class="card"><h2>Slackの連携が完了しました</h2><p>このウィンドウを閉じてください。</p></div></body></html>`

const HTML_ERROR = (msg: string) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Flownote</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0e0e10;color:#fff}
.card{text-align:center;padding:40px;border-radius:16px;background:#1a1a1e}
h2{margin:0 0 8px;color:#ef4444}p{color:#888;margin:0}</style></head>
<body><div class="card"><h2>エラーが発生しました</h2><p>${msg}</p></div></body></html>`

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const stateToken = url.searchParams.get('state')

  if (!code || !stateToken) {
    return new Response(HTML_ERROR('パラメータが不足しています'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  // Service role client to bypass RLS
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Verify state token (CSRF protection)
  const { data: stateRow, error: stateError } = await supabase
    .from('oauth_states')
    .select('user_id, created_at')
    .eq('state_token', stateToken)
    .eq('provider', 'slack')
    .single()

  if (stateError || !stateRow) {
    return new Response(HTML_ERROR('無効または期限切れのリクエストです。もう一度お試しください。'), {
      status: 403,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  // Check expiry (10 minutes)
  const createdAt = new Date(stateRow.created_at).getTime()
  if (Date.now() - createdAt > 10 * 60 * 1000) {
    await supabase.from('oauth_states').delete().eq('state_token', stateToken)
    return new Response(HTML_ERROR('リクエストの有効期限が切れました。もう一度お試しください。'), {
      status: 403,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  // Delete used state token
  await supabase.from('oauth_states').delete().eq('state_token', stateToken)

  // Exchange code for Slack token
  const redirectUri = `${SUPABASE_URL}/functions/v1/slack-oauth-callback`
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
    return new Response(HTML_ERROR(`Slack認証に失敗しました: ${tokenData.error}`), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  // Store integration
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
    return new Response(HTML_ERROR('データの保存に失敗しました。もう一度お試しください。'), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  return new Response(HTML_SUCCESS, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
})
