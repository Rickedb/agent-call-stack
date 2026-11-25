// Loads each HTML file given as `in.html=out.png@WIDTH` in one offscreen window and saves the page as a PNG.
// Run with the system Electron:  electron scripts/screenshots/capture.cjs page.html=out.png@460 ...
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')

app.disableHardwareAcceleration()
const wait = ms => new Promise(r => setTimeout(r, ms))

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 460,
    height: 600,
    useContentSize: true,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  })
  for (const arg of process.argv.slice(2).filter(a => a.includes('='))) {
    const [file, rest] = arg.split('=')
    const [out, width = '460'] = rest.split('@')
    win.setContentSize(Number(width), 600)
    await win.loadFile(file)
    await wait(300)
    // The content's own height, not the window's.
    const h = await win.webContents.executeJavaScript(
      'Math.ceil(Math.max(document.getElementById("root").getBoundingClientRect().bottom, document.querySelector(".modal, .overlay, [role=dialog]")?.getBoundingClientRect().bottom ?? 0))',
    )
    win.setContentSize(Number(width), Math.max(200, Math.min(h + 12, 4000)))
    await wait(400)
    const img = await win.webContents.capturePage()
    fs.writeFileSync(out, img.toPNG())
  }
  app.quit()
})
