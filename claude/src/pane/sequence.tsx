import type { Node } from '../../types'
import { MEANING, sequenceOf } from '../names'
import type { Pane } from './context'

// The theme color of each operator, so that one reads apart from another: `&&` and `||` say what
// happens if the command before failed, `;` and `&` plainly, `|` that output flows on.
const COLOR: Record<string, 'success' | 'warning' | 'permission' | undefined> = {
  '&&': 'success',
  '||': 'warning',
  '|': 'permission',
  '|&': 'permission',
}

// The commands of a shell call, as a tree in the order they run (names only, no arguments): the
// pipelines joined by `&&`, `||`, `;` at the top, each pipeline's later commands below the one that
// feeds them, after a `|`. A line that holds one command shows nothing.
export function sequence(c: Pane, n: Node) {
  const { Box, Text } = c.els
  const steps = sequenceOf(n)
  if (!steps.length) return null
  const used = new Set<string>()
  const line = (prefix: string, op: string | undefined, name: string, isCommon: boolean) => {
    if (op) used.add(op)
    return (
      <Text key={`${prefix}${op ?? ''}${name}`} mono wrap="truncate-end">
        <Text dimColor>{prefix}</Text>
        {op ? <Text color={COLOR[op]} dimColor={!COLOR[op]} bold>{`${op} `}</Text> : null}
        <Text dimColor={isCommon}>{name}</Text>
      </Text>
    )
  }
  const rows = steps.flatMap((s, i) => {
    const isLast = i === steps.length - 1
    const inner = isLast ? '   ' : '│  '
    return [
      line(isLast ? '└─ ' : '├─ ', s.join, s.stages[0]!.name, s.stages[0]!.isCommon),
      ...s.stages.slice(1).map((st, j) => line(`${inner}${'   '.repeat(j)}└─ `, st.pipe, st.name, st.isCommon)),
    ]
  })
  return (
    <Box flexDirection="column">
      <Text dimColor>COMMANDS</Text>
      {rows}
      <Text dimColor wrap="truncate-end">
        {[...used].map(op => `${op} ${MEANING[op]}`).join(' · ')}
      </Text>
    </Box>
  )
}
