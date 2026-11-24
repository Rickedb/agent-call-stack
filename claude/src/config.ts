export const PANE = 'ai-call-stack'
export const MAX_NODES = 300
// What the state keeps of one text. Longer text goes whole to a file.
export const KEEP = 8000
// History is kept shorter still: it can be a hundred calls at once.
export const HIST_KEEP = 1500
// What a file keeps: the engine reads and writes up to 4 MiB.
export const FILE_MAX = 1_000_000
// Lines of a text drawn before "Show all".
export const LINES = 20
