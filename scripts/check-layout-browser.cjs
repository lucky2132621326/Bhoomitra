// Isolated, compiled-page layout audit. No requests reach farm APIs.
// Requires Playwright (NODE_PATH may point at a bundled runtime).
const { chromium } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')
;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage()
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/api/')) {
      const body = url.pathname === '/api/auth/me' ? {success:true,user:{role:'farmer'}} : {}
      return route.fulfill({status:url.pathname === '/api/auth/me' ? 200 : 503,json:body})
    }
    if (route.request().resourceType() === 'document') {
      const name = url.pathname === '/dashboard' ? 'dashboard' : url.pathname.slice(1)
      const file = path.resolve('.next/server/app', name + '.html')
      return route.fulfill({contentType:'text/html',body:fs.readFileSync(file)})
    }
    if (url.hostname === 'localhost' && url.pathname.startsWith('/_next/static/')) return route.continue()
    return route.abort()
  })
  const failures = []
  const skipped = []
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({width,height:1000})
    for (const name of ['', '/detection', '/pests', '/map', '/autospray', '/analytics', '/recommendations', '/history', '/about', '/account']) {
      console.log('Checking', width, name || '/dashboard')
      await page.goto('http://localhost:3000/dashboard' + name)
      await page.waitForTimeout(250)
      const check = async suffix => {
        const result = await page.evaluate(() => {
          const main = document.querySelector('main'), aside = document.querySelector('aside'), header = document.querySelector('header')
          const m = main?.getBoundingClientRect(), a = aside?.getBoundingClientRect()
          return { overflow:document.documentElement.scrollWidth > innerWidth + 1,
            overlap: !!m && !!a && getComputedStyle(aside).display !== 'none' && m.left < a.right - 1,
            header:header && getComputedStyle(header).display !== 'none', width:innerWidth }
        })
        if (result.overflow || result.overlap || (width >= 768 && result.header)) failures.push({width,name,suffix,...result})
      }
      await check('expanded')
      if (width >= 768) {
        const toggle = page.getByRole('button',{name:'Collapse sidebar',exact:true})
        if (!await toggle.count()) { skipped.push({width,name,reason:'Requires populated API fixtures'}); continue }
        await toggle.click()
        await page.waitForTimeout(350)
        await check('collapsed')
      }
      if (name === '/pests' && width === 1440) await page.screenshot({path:'/tmp/bhoomitra-layout-desktop.png'})
      if (name === '/pests' && width === 390) await page.screenshot({path:'/tmp/bhoomitra-layout-mobile.png'})
    }
  }
  await browser.close()
  console.log(JSON.stringify({failures,skipped},null,2))
  if (failures.length) process.exitCode = 1
})().catch(e => { console.error(e); process.exit(1) })
