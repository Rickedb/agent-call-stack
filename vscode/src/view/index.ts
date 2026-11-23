import type { Session } from '../model'
import { index, makeCtx } from './context'
import { modal } from './modal'
import { section } from './rows'
import { empty, summary, toolbar } from './toolbar'
import type { View } from './types'

export type { View } from './types'
export { LINES } from './types'
export { clip, dur, esc, fmtTokens, tokText } from './format'
export { renderText } from './text'

/**
 * The panel: the toolbar, the counts, and a section per prompt, newest first. The
 * row picked in `v.selected` opens in a modal over all of it.
 */
export const renderBody = (s: Session | undefined, v: View): string => {
  if (!s || !s.nodes.some(n => n.kind === 'prompt')) return empty(v)
  const c = makeCtx(s, v)
  const picked = v.selected ? c.byId.get(v.selected) : undefined
  return [
    toolbar(c),
    summary(c),
    [...c.prompts]
      .reverse()
      .map((top, i) => `${i > 0 ? '<hr>' : ''}${section(c, top)}`)
      .join(''),
    picked ? modal(c, picked) : '',
  ].join('\n')
}

/** The ids of the rows that have children, so that "fold all" knows them. */
export const foldableIds = (s: Session | undefined): string[] => {
  const list = s?.nodes ?? []
  const { kids } = index(list)
  return list.filter(n => (kids.get(n.id) ?? []).length > 0).map(n => n.id)
}

/** True when any call is still running: the bars grow with the clock. */
export const isRunning = (s: Session | undefined): boolean => !!s?.nodes.some(n => n.status === 'run')
