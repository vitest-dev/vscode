// A compact (code-wise, probably not memory-wise) singly linked list node.
type QueueNode<T> = [value: T, next?: QueueNode<T>]

/**
 * Return a function for running multiple async operations with limited concurrency.
 */
export function limitConcurrency(concurrency = Number.POSITIVE_INFINITY): <Args extends unknown[], T>(func: (...args: Args) => PromiseLike<T> | T, ...args: Args) => Promise<T> {
  // The number of currently active + pending tasks.
  let count = 0

  // The head and tail of the pending task queue, built using a singly linked list.
  // Both head and tail are initially undefined, signifying an empty queue.
  // They both become undefined again whenever there are no pending tasks.
  let head: undefined | QueueNode<() => void>
  let tail: undefined | QueueNode<() => void>

  // A bookkeeping function executed whenever a task has been run to completion.
  const finish = () => {
    count--

    // Check if there are further pending tasks in the queue.
    if (head) {
      // Allow the next pending task to run and pop it from the queue.
      head[0]()
      head = head[1]

      // The head may now be undefined if there are no further pending tasks.
      // In that case, set tail to undefined as well.
      tail = head && tail
    }
  }

  return (func, ...args) => {
    // Create a promise chain that:
    //  1. Waits for its turn in the task queue (if necessary).
    //  2. Runs the task.
    //  3. Allows the next pending task (if any) to run.
    return new Promise<void>((resolve) => {
      if (count++ < concurrency) {
        // No need to queue if fewer than maxConcurrency tasks are running.
        resolve()
      }
      else if (tail) {
        // There are pending tasks, so append to the queue.
        tail = tail[1] = [resolve]
      }
      else {
        // No other pending tasks, initialize the queue with a new tail and head.
        head = tail = [resolve]
      }
    }).then(() => {
      // Running func here ensures that even a non-thenable result or an
      // immediately thrown error gets wrapped into a Promise.
      return func(...args)
    }).finally(finish)
  }
}

export function assert(condition: unknown, message: string | (() => string)): asserts condition {
  if (!condition) {
    throw new Error(typeof message === 'string' ? message : message())
  }
}

const driveLetter = process.platform === 'win32' ? __dirname[0] : null

export function normalizeDriveLetter(path: string) {
  if (!driveLetter)
    return path
  return driveLetter + path.slice(1)
}

export function createQueuedHandler<T>(resolver: (value: T[]) => Promise<void>) {
  const cached = new Set<T>()
  let promise: Promise<void> | null = null
  let timer: NodeJS.Timeout | null = null
  return (value: T) => {
    cached.add(value)
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      if (promise) {
        return
      }
      const values = Array.from(cached)
      cached.clear()
      promise = resolver(values).finally(() => {
        promise = null
      })
    }, 50)
  }
}
