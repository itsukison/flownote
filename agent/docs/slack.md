
## The core concept: you need a Slack App that your users install into their workspace

Since Flownote is a multi-tenant product (each user has their own Slack workspace), you can't use a single hardcoded bot token. You need to implement **OAuth 2.0**, where each user goes through a "Connect to Slack" flow that gives you a token scoped to their workspace. You store that token per user, and use it whenever you send them a message.

---

## Step 1: Create your Slack App at api.slack.com

Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app "From scratch." This gives you a `Client ID` and `Client Secret` — treat these like environment variables, never commit them.

Note: as of June 2024, classic Slack apps are gone. All new integrations must use the current app model.

Under **OAuth & Permissions**, add these **Bot Token Scopes**:
- `chat:write` — to send messages
- `channels:read` — to let users pick which channel to post to
- `incoming-webhook` — simplest way to post to a specific channel (optional but useful)

---

## Step 2: Implement the OAuth connect flow

This is the "Connect Slack" button on your Workflow page. When a user clicks it, you redirect them to Slack's authorization URL:

```
https://slack.com/oauth/v2/authorize
  ?client_id=YOUR_CLIENT_ID
  &scope=chat:write,channels:read,incoming-webhook
  &redirect_uri=https://flownote-jp.com/auth/slack/callback
  &state=USER_ID_OR_SESSION_TOKEN
```

The `state` parameter is important — use it to pass your Flownote user's ID so you know who to associate the token with when Slack redirects back.

When Slack redirects back to your `redirect_uri`, you get a temporary `code`. Exchange it for a real token on your backend:

```js
// Your backend callback handler
const response = await fetch('https://slack.com/api/oauth.v2.access', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID,
    client_secret: process.env.SLACK_CLIENT_SECRET,
    code: req.query.code,
    redirect_uri: 'https://flownote-jp.com/auth/slack/callback'
  })
});
const data = await response.json();
// data.access_token is the bot token (xoxb-...)
// data.incoming_webhook.url is a ready-to-use webhook URL
// data.team.name is the workspace name — show this in your UI
```

The OAuth response contains an `incoming_webhook` object with a `url` field — a webhook URL you can immediately use to post messages to whichever channel the user picked during install.

Save `access_token`, `incoming_webhook.url`, and `team.name` to your database, linked to that user's account.

---

## Step 3: Sending a message

Once you have the token stored, sending a message is just a POST request. Use the `chat.postMessage` API endpoint with the token in the `Authorization` header.

```js
// Called from your backend when a meeting ends (or button is pressed)
async function sendSlackMessage(userSlackToken, channelId, text) {
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userSlackToken}`
    },
    body: JSON.stringify({
      channel: channelId,
      text: text
    })
  });
}
```

Or if you saved the webhook URL (simpler, no channel ID needed):

```js
async function sendViaWebhook(webhookUrl, text) {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
}
```

---

## Step 4: Triggering it from your two use cases

**Use case 1 — Auto send when meeting ends:**
When your app detects a meeting has finished (you likely already have this event), call `sendSlackMessage` from your backend with the AI-generated evaluation as the `text`.

**Use case 2 — Send when user presses a button:**
Your frontend button just hits a Flownote API endpoint (e.g. `POST /api/workflow/send-actions`), which looks up that user's stored Slack token and calls `sendSlackMessage` with the next actions.

---

## Key things to store per user in your DB

| Field | What it is |
|---|---|
| `slack_access_token` | The `xoxb-...` bot token |
| `slack_webhook_url` | Optional, for quick posting to a fixed channel |
| `slack_channel_id` | The channel they want messages sent to |
| `slack_team_name` | Display in your UI ("Connected to: flownote-team") |

---

## One important note

Bot tokens (`xoxb-`) represent your app's independent identity and aren't tied to any specific user account — they're more stable and should be your default choice. Don't use user tokens (`xoxp-`) unless you specifically need to act on a user's behalf.

Be mindful of Slack's rate limits, which are typically 1 request per second per method. For Flownote's use case this won't be an issue since you're sending one message per meeting, not in bulk.