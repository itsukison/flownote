/**
 * Slack API service — sends messages via chat.postMessage and lists channels.
 */

export interface SlackChannel {
  id: string
  name: string
  is_private: boolean
}

/**
 * Send a message to a Slack channel using the bot token.
 */
export async function sendSlackMessage(
  accessToken: string,
  channelId: string,
  text: string
): Promise<void> {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ channel: channelId, text }),
  })

  const data = await res.json()
  if (!data.ok) {
    throw new Error(`Slack chat.postMessage failed: ${data.error}`)
  }
}

/**
 * List channels the bot has access to.
 */
export async function listSlackChannels(
  accessToken: string
): Promise<SlackChannel[]> {
  const channels: SlackChannel[] = []
  let cursor: string | undefined

  // Paginate through all channels
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
      limit: '200',
    })
    if (cursor) params.set('cursor', cursor)

    const res = await fetch(
      `https://slack.com/api/conversations.list?${params}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    )

    const data = await res.json()
    if (!data.ok) {
      throw new Error(`Slack conversations.list failed: ${data.error}`)
    }

    for (const ch of data.channels ?? []) {
      channels.push({
        id: ch.id,
        name: ch.name,
        is_private: ch.is_private ?? false,
      })
    }

    cursor = data.response_metadata?.next_cursor
    if (!cursor) break
  }

  return channels.sort((a, b) => a.name.localeCompare(b.name))
}
