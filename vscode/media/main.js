// The webview only draws what the extension sends and reports what is pressed.
;(function () {
  const vscode = acquireVsCodeApi()
  const root = document.getElementById('root')
  let isDown = false

  document.addEventListener('mousedown', () => (isDown = true))
  document.addEventListener('mouseup', () => (isDown = false))

  window.addEventListener('message', e => {
    const m = e.data
    if (!m || m.type !== 'render') return
    // The clock redraws once a second; it must not eat a press, a selection
    // being made, or an open drop-down.
    if (m.tick) {
      if (isDown || String(window.getSelection() || '') !== '') return
      if (document.activeElement && document.activeElement.tagName === 'SELECT') return
    }
    const y = window.scrollY
    root.innerHTML = m.html
    window.scrollTo(0, y)
  })

  document.addEventListener('click', e => {
    const el = e.target instanceof Element ? e.target.closest('[data-act]') : null
    if (!el || el.tagName === 'SELECT') return
    vscode.postMessage({
      act: el.dataset.act,
      id: el.dataset.id,
      which: el.dataset.which,
      v: el.dataset.v,
    })
  })

  document.addEventListener('change', e => {
    const el = e.target instanceof Element ? e.target.closest('select[data-act]') : null
    if (el) vscode.postMessage({ act: el.dataset.act, v: el.value })
  })

  vscode.postMessage({ act: 'ready' })
})()
