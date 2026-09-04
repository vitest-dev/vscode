import { expect, test } from 'vitest'
import { page } from 'vitest/browser'

test('records a trace', async () => {
  document.body.innerHTML = '<button>Submit</button>'
  await page.getByRole('button').mark('Render button')
  await expect.element(page.getByRole('button')).toBeVisible()
})
