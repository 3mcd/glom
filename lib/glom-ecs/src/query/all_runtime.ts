import type { AllDescriptor } from "../system_descriptor"
import type { World } from "../world"
import type { All } from "./all"
import type { Term } from "./term"

export function make_all<
  T0 extends Term,
  T1 extends Term,
  T2 extends Term,
  T3 extends Term,
  T4 extends Term,
  T5 extends Term,
  T6 extends Term,
  T7 extends Term,
>(
  desc: AllDescriptor<T0, T1, T2, T3, T4, T5, T6, T7>,
  world: World,
): All<T0, T1, T2, T3, T4, T5, T6, T7> {
  return {
    desc,
    [Symbol.iterator]: () => {
      return {
        next: () => {
          return {
            value: [
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
            ],
            done: true,
          }
        },
      }
    },
  }
}
