const missingTagsMessage = 'define any "tags"'

export function addProfileHint(message: string, profile: string): string {
  if (!message.includes('Vitest config') || !message.includes(missingTagsMessage)) {
    return message
  }

  return [
    message,
    '',
    `Vitest used the "${profile}" profile for this test.`,
    'If another config defines this tag, select its profile with "Execute Using Profile..." or disable this one with "Vitest: Toggle Configs".',
  ].join('\n')
}
