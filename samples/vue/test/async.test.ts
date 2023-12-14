import { nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import AsyncWrapper from '../components/AsyncWrapper.vue'

it('async component with suspense', async () => {
  expect(AsyncWrapper).toBeTruthy()

  let resolve: Function
  const promise = new Promise(_resolve => resolve = _resolve)
  const wrapper = mount(AsyncWrapper, {
    props: {
      promise,
    },
  })

  await nextTick()

  expect(wrapper.text()).toContain('fallback')

  resolve()

  await flushPromises()
  await nextTick()
  await nextTick()

  const text = wrapper.text()
  expect(text).toContain('resolved')
})
