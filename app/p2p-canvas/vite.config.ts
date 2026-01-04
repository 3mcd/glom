import {defineConfig} from "vite"
import {glomRollupPlugin} from "@glom/transformer-rollup"

export default defineConfig({
  plugins: [glomRollupPlugin()],
  build: {
    target: "esnext",
  },
})
