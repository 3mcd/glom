import {glomRollupPlugin} from "@glom/transformer-rollup"
import {defineConfig} from "vite"

export default defineConfig({
  plugins: [glomRollupPlugin()],
  build: {
    target: "esnext",
  },
})
