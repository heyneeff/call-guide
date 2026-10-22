# Call Guide

A clickable, branching cold-call guide. One question at a time, answer buttons
underneath, pains tagged automatically, and every branch ends in one of three
closes: **book the $750 audit**, **schedule a callback**, or **polite exit**.

No backend, no build step. Plain HTML/JS plus JSON scripts.

## Run it

Double-click **`start.command`**. It serves this folder at
`http://localhost:8765` and opens your browser. Close the Terminal window to
stop it.

(Opening `index.html` directly from disk won't load the scripts, because
browsers block that. The page will offer a file picker as a fallback.)

Saved calls live in that browser's localStorage for `localhost:8765`. Always
use the same browser and `start.command` so your log stays in one place, and
export the CSV now and then as a backup.

## During a call

- Type the **business name** (and contact/phone) at the top. The timer starts on your first click or keystroke.
- Click an answer, or press **1–9**. **←** or **Backspace** goes back (and un-tags that step's pains).
- **Section chips** along the top jump anywhere, for when the prospect jumps ahead.
- **Objection bar** at the bottom is always there. Each response has paths, including "Back to where we were".
- **Wrap up → close** goes to the close from anywhere. The suggested close is highlighted (3+ pains → audit, 1+ → callback).
- **Pain summary** fills in as you go. Remove one with ×, or type your own.
- **Save & finish call** on a close screen logs the call and clears everything for the next dial.
- **New call** saves the current one as "Unfinished" if anything was entered.
- **Call log → Export CSV** downloads every call: outcome, follow-up date, pains, owner's wish, objections, path, notes.

Set your name under **Your details** in the sidebar. It fills in `{{me}}`.

## Editing the scripts

Everything is in `scripts/`. Edit the JSON and refresh the page. If you break
a link (a typo in a `next`, an undefined pain tag), a yellow banner lists
exactly what's wrong.

| File | What's in it |
|---|---|
| `index.json` | Which industries show up in the dropdown |
| `common.json` | The three closes and the five objections, shared by every industry |
| `solar.json` | The solar tree |
| `_template.json` | Starting point for a new industry (ignored by the app) |

### Adding an industry (e.g. roofing)

1. Copy `_template.json` to `roofing.json` and write the nodes.
2. Add it to `index.json`:
   ```json
   { "id": "roofing", "label": "Roofers", "file": "roofing.json" }
   ```
3. Refresh. The closes and objections come along automatically. To change an
   objection's wording for roofing only, add an `"objections"` block to
   `roofing.json` with the same id (e.g. `"have_software"`).

### Node format

```json
"lead_speed": {
  "section": "Lead flow",
  "question": "How fast does a new lead get a call back?",
  "say": "And when a new lead comes in, how fast does someone get back to them?",
  "why": "Speed-to-lead decides who wins shared leads.",
  "answers": [
    { "label": "Within an hour", "next": "sales_proposal" },
    { "label": "Next day or later", "next": "sales_proposal", "pains": ["slow-lead-response"] },
    { "label": "Not interested", "objection": "not_interested" }
  ]
}
```

- `say` can be one string or a list of lines.
- `pains` are ids from that file's `painTags`, which hold the label shown in the sidebar.
- `wish` on an answer sets "If one thing ran itself" (used in the close).
- `minPains` on an answer marks it as the suggested choice once that many pains are tagged.
- End nodes use `"type": "end"` plus `outcome`, `outcomeLabel`, `checklist`, and `capture` (a date/time field).
- Objection paths can use `"next": "resume"` (back to where you were) or `"@quick"`, `"@process"`, `"@tools"`, which point at that industry's `anchors`.

### Placeholders in text

`{{me}}`, `{{business}}`, `{{contact}}`, `{{phone}}`, `{{topPain}}`,
`{{pains}}` (top three), `{{wish}}`, plus anything in the industry's `vars`
(solar has `{{trade}}` and `{{finishLine}}`).

Add a fallback with a pipe: `{{contact|the owner}}`. A line whose placeholder
is empty and has no fallback is skipped. That's how "First thing I'd look at:
{{topPain}}" disappears when nothing's been tagged yet.
