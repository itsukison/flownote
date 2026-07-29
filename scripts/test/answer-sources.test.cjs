/**
 * Regression coverage for answer richness and source citations. No provider,
 * database, or browser is contacted.
 */
const fs = require('node:fs')
const path = require('node:path')
const { extractMcpSearchContent } = require('../../.tmp-test-build/services/mcpResult.js')

let failures = 0
const assert = (name, cond, extra = '') => {
  if (!cond) failures++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
}

const jsonResult = extractMcpSearchContent({
  content: [{
    type: 'text',
    text: JSON.stringify({
      results: [
        { title: '料金表', snippet: '月額3万円から', url: 'https://kb.example.com/pricing' },
        { doc_title: '導入事例', content: '導入実績120社', source: { uri: 'https://kb.example.com/cases' } },
        { title: '危険なリンク', snippet: '開かない', url: 'javascript:alert(1)' },
      ],
    }),
  }],
})
assert('JSON search results become separate chunks', jsonResult.chunks.length === 3)
assert('exact result URLs are retained', jsonResult.sources.length === 2)
assert('source title is retained', jsonResult.sources[0]?.name === '料金表')
assert('non-http URLs are never exposed', jsonResult.sources.every((source) => /^https?:/.test(source.url)))

const linkedResult = extractMcpSearchContent({
  content: [
    { type: 'resource_link', name: '契約条件', uri: 'https://kb.example.com/terms', description: '契約は1年単位' },
    { type: 'resource_link', title: '同じ資料', uri: 'https://kb.example.com/terms' },
  ],
})
assert('MCP resource links contribute answer context', linkedResult.chunks[0]?.includes('契約は1年単位'))
assert('duplicate source URLs collapse to one footer item', linkedResult.sources.length === 1)

const plainResult = extractMcpSearchContent({ content: [{ type: 'text', text: '社内ナレッジの回答' }] })
assert('plain-text MCP results remain valid context', plainResult.chunks[0] === '社内ナレッジの回答')
assert('plain text does not invent an exact citation', plainResult.sources.length === 0)

const repoRoot = path.resolve(__dirname, '../..')
const responseSource = fs.readFileSync(path.join(repoRoot, 'electron/ipc/response.ts'), 'utf8')
assert('support prompt requests 5–7 bullets', responseSource.includes('5〜7項目'))
assert('support prompt makes the first bullet a conclusion', responseSource.includes('「結論:」'))
assert('support prompt pins the honest fallback', responseSource.includes('資料に直接の記載なし'))
assert('retrieved chunks are individually labelled', responseSource.includes('`【資料${i + 1}】'))
assert('support output ceiling is 1000 tokens', responseSource.includes("mode === 'support' ? 1000 : 1300"))

const migrationDir = path.join(repoRoot, 'supabase/migrations')
const migrationName = fs.readdirSync(migrationDir).find((name) => name.endsWith('_add_answer_source_metadata.sql'))
const migration = migrationName ? fs.readFileSync(path.join(migrationDir, migrationName), 'utf8') : ''
assert('source migration returns document ids', /document_id uuid/.test(migration))
assert('source migration returns document names', /document_name text/.test(migration))
assert('retrieval RPC respects caller RLS', /security invoker/i.test(migration))
assert('anonymous RPC execution is revoked', /revoke all[\s\S]*from public, anon/i.test(migration))
assert('migration preserves the legacy RPC for older clients', !/drop function/i.test(migration))
assert('new source-aware RPC has a rollout-safe name', /match_chunks_with_sources/.test(migration))

console.log(failures === 0 ? '\nall assertions passed' : `\n${failures} assertion(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
