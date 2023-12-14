import antfu from '@antfu/eslint-config'

export default antfu({
  formatters: true,
  rules: {
    'import/no-named-as-default': 'off',
    'no-console': 'off',
    'ts/ban-ts-comment': 'off',
  },
  ignores: ['*.svelte', '**/*.svelte/**', '*.snap', '**/*.snap/**', '*.d.ts', '**/*.d.ts/**', 'samples', '**/samples/**'],
}, {

})
