export function assert(
  condition: boolean,
  message: string = "Assertion failed",
) {
  if (!condition) {
    throw new Error(message)
  }
}

export function assertDefined<T>(value: T): asserts value is NonNullable<T> {
  if (value === undefined) {
    throw new Error("Value is undefined")
  }
}
