import { expect, test } from 'vitest'
import { page } from 'vitest/browser'

test('records a trace', async () => {
  document.body.innerHTML = '<button>Submit FOO</button>'
  await page.getByRole('button').mark('Render button')
  await expect.element(page.getByRole('button')).toBeVisible()
})

test('records a second trace', async () => {
  document.body.innerHTML = '<button>Cancel BAR</button>'
  await page.getByRole('button').mark('Render cancel button')
  await expect.element(page.getByRole('button')).toHaveTextContent('Cancel BAR')
})
