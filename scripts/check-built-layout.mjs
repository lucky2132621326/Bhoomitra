// Run after next build: catches missing generated CSS that source tests miss.
import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
const css = readdirSync('.next/static/css').filter(f => f.endsWith('.css'))
  .map(f => readFileSync(`.next/static/css/${f}`, 'utf8')).join('\n')
for (const selector of ['md\\:hidden', 'md\\:flex', 'md\\:ml-72', 'md\\:ml-20', 'bg-purple-600', 'border-purple-700']) {
  assert.ok(css.includes(selector), `Missing production layout utility: ${selector}. Rebuild without the stale Next cache.`)
}
console.log('Production responsive layout and zone-colour utilities passed.')
