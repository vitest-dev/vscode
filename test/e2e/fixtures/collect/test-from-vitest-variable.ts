import { Vitest } from './vitest'

Vitest.describe('TicketDetailBottomBar', () => {
  Vitest.it.each(['submit', 'discard'])(
    'emits %s event when button is clicked',
    async (eventName) => {
    },
  )

  Vitest.describe('Drafts', () => {
    Vitest.it.todo('should not display draft information if ticket has no draft')
    Vitest.it.todo('should display draft information if ticket has a draft')
  })
})
