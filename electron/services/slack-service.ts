/**
 * Slack API service — sends messages via chat.postMessage and lists channels.
 */

export interface SlackChannel {
  id: string
  name: string
  is_private: boolean
}

function applyOutsideCodeFences(text: string, transform: (segment: string) => string) {
  const fenceRegex = /```[\s\S]*?```/g
  let result = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = fenceRegex.exec(text)) !== null) {
    result += transform(text.slice(lastIndex, match.index))
    result += match[0]
    lastIndex = match.index + match[0].length
  }

  result += transform(text.slice(lastIndex))
  return result
}

/**
 * Convert common Markdown to Slack mrkdwn so Gemini output renders correctly.
 * Slack does not support Markdown headings or **bold**.
 */
export function formatSlackMessage(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n')

  return applyOutsideCodeFences(normalized, (segment) => {
    let out = segment

    // Markdown links -> Slack links
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<$2|$1>')

    // Headings -> bold lines
    out = out.replace(/^(#{1,6})\s+(.+)$/gm, (_m, _h, title) => `*${title.trim()}*`)

    // Unordered lists -> bullet
    out = out.replace(/^(\s*)[-*]\s+(?=\S)/gm, (_m, indent) => `${indent}• `)

    // Bold: **text** or __text__ -> *text*
    out = out.replace(/\*\*([^\n*]+?)\*\*/g, '*$1*')
    out = out.replace(/__([^\n_]+?)__/g, '*$1*')

    return out
  })
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
    body: JSON.stringify({ channel: channelId, text, mrkdwn: true }),
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
