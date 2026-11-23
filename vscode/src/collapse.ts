import type { Session } from './model'

/**
 * When a prompt shows up, the ones before it fold away. This looks at every
 * session, finds the prompts not seen before, and folds all but the newest of
 * each session that has one. A prompt the person opens afterwards stays open
 * until the next prompt comes. Says whether anything was folded.
 */
export const collapseOlder = (
  sessions: Iterable<Session>,
  seen: Set<string>,
  folded: Set<string>,
): boolean => {
  let changed = false
  for (const s of sessions) {
    const prompts = s.nodes.filter(n => n.kind === 'prompt')
    const fresh = prompts.filter(p => !seen.has(p.id))
    if (fresh.length === 0) continue
    for (const p of fresh) seen.add(p.id)
    const newest = prompts[prompts.length - 1]
    for (const p of prompts) {
      if (p !== newest && !folded.has(p.id)) {
        folded.add(p.id)
        changed = true
      }
    }
  }
  return changed
}
