import { test, expect } from '@playwright/test'

test('all interactive targets meet 44pt minimum', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('http://localhost:5173')

  const small = await page.evaluate(() => {
    const sels = ['button', 'a', '[role="button"]', '[role="tab"]', 'input', 'select']
    const out: { selector: string; w: number; h: number }[] = []
    for (const sel of sels) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        if (r.width < 44 || r.height < 44) {
          out.push({ selector: el.outerHTML.slice(0, 80), w: r.width, h: r.height })
        }
      }
    }
    return out
  })
  expect(small).toEqual([])
})
