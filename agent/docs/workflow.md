Information architecture
The Workflow page needs two levels:
Level 1 — Workflow list (the homepage of the page)
A list of all their workflows, each as a card showing name, trigger summary, on/off status, and last run time. A single + 新しいワークフロー button at the top. This is the view they return to every time. Familiar — it's exactly how kintone and other Japanese SaaS tools present automation lists.
Level 2 — Workflow editor (entered by clicking a card or creating new)
The block-based builder. Always reachable via breadcrumb ワークフロー > [名前] so they never feel lost.

Level 1: Workflow list — design details
Each workflow card shows:

Workflow name (user-named, e.g. "商談後レポート送信")
A one-line trigger summary ("会議終了時に実行")
How many steps it has ("3ステップ")
Last run timestamp
On/off toggle — right on the card, no need to enter the editor just to pause it
A status indicator: 正常 (green) / エラー (red) / 未設定 (gray)

Empty state (first time): don't show an empty list. Show a full-width prompt with 2–3 template cards they can start from. "テンプレートから始める" feels much safer to Japanese users than a blank canvas.

Level 2: Workflow editor — rethought carefully
At the top: a name field (pre-filled "新しいワークフロー 1"), a Save button, and an Activate toggle — clearly separated, Activate is only clickable after saving.
The builder is a vertical canvas with three distinct zones, visually separated:
Zone A — Trigger (always exactly one)
A single block, always at the top, not deletable. Inside it: a dropdown to pick the trigger type. If they pick "スケジュール", a time/day picker appears inline. The block has a distinct visual treatment — slightly different background, a lightning bolt icon — so it reads as "the start."
Zone B — Steps (repeatable)
Each step is a card with:

A type selector at the top of the card: AI処理 / 条件分岐 / Slack送信 — shown as three tabs or a segmented control, not a dropdown. Tabs are immediately scannable.
Content changes based on type (prompt editor, condition builder, Slack composer)
A drag handle on the left for reordering
A delete button (trash icon) top-right, with a confirmation tooltip on hover ("削除しますか？")

Between each step card: a small + button centered on the connecting line. Clicking it inserts a new step at that position. This is the only way to add steps — no "add step" button at the bottom that gets lost.
Zone C — Variable system
This is the most important part to get right for non-technical users. Variables must never look like code. Rules:

Every block that produces output gets a label assigned automatically: ステップ1の結果, ステップ2の結果, or the user can rename it
When composing a prompt or Slack message, a { } button opens a visual variable picker — a small panel listing all available upstream outputs as named chips, not {{raw_syntax}}
Once inserted, variables render as colored inline pills (e.g. a purple pill that says "文字起こし") — users never see {{transcript}}
If a user deletes a step whose output is used downstream, the dependent pill turns red with a warning — they can't activate until resolved

Condition block — simplified for enterprise
Don't expose freeform logic. Use a sentence template:
もし [変数を選ぶ▼] が [含む▼] [入力欄] なら → [続ける / 止める▼]
Three dropdowns and one text input. That's it. Feels like filling out a form, not writing logic.
Slack send block

Channel picker: a searchable dropdown populated from their connected workspace (fetched via Slack API)
Message composer: textarea with the { } variable picker
Preview button: shows a realistic Slack message preview in a small modal — this is huge for trust, especially for Japanese users who want to verify before activating


The connection state
If Slack isn't connected yet and they try to add a Slack send block: don't show an error after the fact. The Slack block should show a grayed-out "Slack未連携" state with a single inline "Slackを連携する" button that opens the OAuth flow in a modal — they complete it and return to exactly where they were, without losing their work.

Onboarding the very first time
When the workflow list is empty, instead of the list, show:
A centered panel with a short sentence explaining what workflows do (one line), then 3 template cards:

会議終了 → 評価レポートをSlackへ
会議終了 → ネクストアクションをSlackへ
毎朝7時 → 前日の会議サマリーをSlackへ

Clicking a template pre-fills the entire editor with a working workflow — they just pick their Slack channel and hit Activate. First success in under 2 minutes. That's the target.