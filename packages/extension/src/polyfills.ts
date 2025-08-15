if (!Promise.withResolvers) {
  Promise.withResolvers = function withResolvers<T>() {
    let a: (v: T | PromiseLike<T>) => void
    let b: (r?: any) => void
    const c = new this<T>((resolve, reject) => {
      a = resolve
      b = reject
    })
    return { resolve: a!, reject: b!, promise: c }
  }
}
