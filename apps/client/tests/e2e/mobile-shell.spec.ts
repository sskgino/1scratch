import { test, expect } from '@playwright/test'

test.describe('mobile shell @ 375x812', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('renders MobileShell, cycles tabs, send creates a card, resize swaps to desktop', async ({ page }) => {
    await page.goto('/?e2e=1')

    await expect(page.locator('[data-mobile-shell]')).toBeVisible()

    for (const t of ['Capture', 'Canvas', 'Library', 'You']) {
      await page.getByRole('tab', { name: t }).click()
    }
    await page.getByRole('tab', { name: 'Capture' }).click()
    await page.getByPlaceholder('Type or speak…').fill('hello')
    await page.getByRole('button', { name: 'Send' }).click()
    // Plan §6.10 used getByText('hello') — that's ambiguous because the
    // textarea's value is also 'hello' until React rerenders. Target the
    // CardBubble button (which carries timestamp + prompt) instead.
    await expect(page.getByRole('button', { name: /hello/ })).toBeVisible()

    await page.setViewportSize({ width: 1200, height: 800 })
    await expect(page.locator('[data-mobile-shell]')).toBeHidden()
  })
})
