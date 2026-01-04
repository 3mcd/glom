import {createTransformer} from "@glom/transformer"
import type {BunPlugin} from "bun"
import ts from "typescript"

export function glomBunPlugin(): BunPlugin {
  let program: ts.Program

  return {
    name: "glom-transformer",
    setup(build) {
      build.onLoad({filter: /\.ts$/}, async (args) => {
        const text = await Bun.file(args.path).text()

        if (!program || !program.getSourceFile(args.path)) {
          const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists)
          if (configPath) {
            const config = ts.readConfigFile(configPath, ts.sys.readFile)
            const parsedConfig = ts.parseJsonConfigFileContent(
              config.config,
              ts.sys,
              process.cwd(),
            )
            program = ts.createProgram({
              rootNames: parsedConfig.fileNames,
              options: parsedConfig.options,
              oldProgram: program,
            })
          }
        }

        const sourceFile = program?.getSourceFile(args.path)
        if (!sourceFile) {
          return {contents: text, loader: "ts"}
        }

        const transformer = createTransformer(program)
        const result = ts.transform(sourceFile, [transformer])

        const printer = ts.createPrinter()
        const transformedCode = printer.printFile(result.transformed[0])

        return {
          contents: transformedCode,
          loader: "ts",
        }
      })
    },
  }
}
