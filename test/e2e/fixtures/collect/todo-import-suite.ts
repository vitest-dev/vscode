import { describe, it } from 'vitest'

describe('TicketDetailBottomBar', () => {
  it.each(['submit', 'discard'])(
    'emits %s event when button is clicked',
    async (eventName) => {
    },
  )

  describe('Drafts', () => {
    it.todo('should not display draft information if ticket has no draft')
    it.todo('should display draft information if ticket has a draft')
  })
})
