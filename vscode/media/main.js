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
    // A redraw replaces everything: keep where the page and the modal's body were scrolled to.
    const y = window.scrollY
    const had = root.querySelector('.modal')
    const inner = had ? (had.querySelector('.modal-body') || {}).scrollTop || 0 : 0
    const focusIn = !!(had && document.activeElement && had.contains(document.activeElement))
    root.innerHTML = m.html
    window.scrollTo(0, y)
    const modal = root.querySelector('.modal')
    if (modal) {
      const body = modal.querySelector('.modal-body')
      if (body) body.scrollTop = inner
      // Opening takes the keyboard, so that Esc closes it; a redraw gives it back
      // to the dialog if it was in the dialog, and leaves it alone otherwise.
      if (!had || focusIn) modal.focus({ preventScroll: true })
    }
  })

  document.addEventListener('click', e => {
    const el = e.target instanceof Element ? e.target.closest('[data-act]') : null
    if (!el || el.tagName === 'SELECT') return
    // A copy: the icon says so for a moment (the page is not redrawn for it).
    if (el.classList.contains('copy-icon')) {
      el.classList.add('done')
      setTimeout(() => el.classList.remove('done'), 1500)
    }
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

  // Esc closes the modal.
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && root.querySelector('.modal')) {
      e.preventDefault()
      vscode.postMessage({ act: 'close' })
    }
  })

  vscode.postMessage({ act: 'ready' })
})()
