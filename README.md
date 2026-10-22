# Call Guide

A clickable, branching cold-call guide. One question at a time, answer buttons
underneath, pains tagged automatically, and every branch ends in one of three
closes: **book the $750 audit**, **schedule a callback**, or **polite exit**.

No backend, no build step. Plain HTML/JS plus JSON scripts.

## Run it

**Online:** https://heyneeff.github.io/call-guide/ (GitHub Pages, rebuilds about a
minute after every push to `main`). To publish script edits:

```bash
cd ~/Developer/fieldops-leadgen/call-guide
git commit -am "Tweak solar wording" && git push
```

**Locally:** double-click **`start.command`**. It serves this folder at
`http://localhost:8765` and opens your browser. Close the Terminal window to
stop it.

(Opening `index.html` directly from disk won't load the scripts, because
browsers block that. The page will offer a file picker as a fallback.)

Saved calls live in that browser's localStorage for `localhost:8765`. Always
use the same browser and `start.command` so your log stays in one place, and
export the CSV now and then as a backup.

## During a call

- Type the **business name** (and contact/phone) at the top, plus a **hook** from the lead sheet's Score Reasons (e.g. "340 reviews but no online quote form"). The hook shows up in the opener. The timer starts on your first click or keystroke.
- Click an answer, or press **1–9**. **←** or **Backspace** goes back (and un-tags that step's pains).
- **Section chips** along the top jump anywhere, for when the prospect jumps ahead.
- **Go deeper** (or press **D**) opens the pain funnel any time they mention a problem. Type what it costs them, in their words. The close repeats it back to them.
- **Objection bar** at the bottom is always there. Each response has paths, including "Back to where we were".
- **Wrap up → close** goes to the close from anywhere. Once you've found 2 pains it lights up: that's your cue to stop asking questions and close.
- **Pain summary** fills in as you go. Click a pain to ★ it as the main one (the close leads with it). Remove one with ×, or type your own.
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

## How the call is built

The script follows standard cold-call practice. Keep this in mind when you
edit it:

1. **Permission opener.** Say it's a cold call and ask for 30 seconds. Never open with "is this a bad time?"
2. **Reason for the call plus a problem statement**, ending on a question about that problem ("is that something you run into, or are you buttoned up?"). Don't ask "can I ask you some questions?"
3. **Discovery goes deep, not wide.** Find the problem, ask what it costs them, then use the pain funnel (Go deeper) to get a number in their words. A pain they haven't put a number on won't close.
4. **Close as soon as you have 2 real pains.** The goal of the call is the audit. The audit is where the full discovery happens.
5. **Bridge:** summarize their pain in their words and get a "yes, that's it" before you pitch.
6. **Ask with two specific times, then go quiet.** Expect pushback after the ask (price, partner, timing, "just tell me", "send me something"). Each one has a node: acknowledge it, answer briefly, and ask again or offer a smaller step.
7. **Lock it in** with an up-front agreement about what happens after the audit, and send the invite while you're still on the phone.
8. **Exits still ask for something**: what would change their mind, permission to follow up, or a referral.

Each pain tag can have a `tip`: a real quick win you can give away when they
say "just tell me what to fix." `{{tip}}` uses the tip for the main pain.
