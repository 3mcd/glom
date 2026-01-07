import type {Plugin} from "rollup"
import ts from "typescript"
import {createTransformer} from "@glom/transformer"

export interface RollupTransformerOptions {
  tsconfig?: string
}

export function glomRollupPlugin(
  options: RollupTransformerOptions = {},
): Plugin {
  let program: ts.Program

  return {
    name: "glom-transformer",
    enforce: "pre",
    buildStart() {
      const configPath =
        options.tsconfig || ts.findConfigFile(process.cwd(), ts.sys.fileExists)
      if (!configPath) throw new Error("Could not find tsconfig.json")

      const config = ts.readConfigFile(configPath, ts.sys.readFile)
      const parsedConfig = ts.parseJsonConfigFileContent(
        config.config,
        ts.sys,
        process.cwd(),
      )

      program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options)
    },
    transform(_code: string, id: string) {
      if (!id.endsWith(".ts") || id.endsWith(".d.ts")) return null

      if (!program || !program.getSourceFile(id)) {
        const configPath =
          options.tsconfig ||
          ts.findConfigFile(process.cwd(), ts.sys.fileExists)
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

      const sourceFile = program?.getSourceFile(id)
      if (!sourceFile) return null

      const transformer = createTransformer(program)
      const result = ts.transform(sourceFile, [transformer])

      const printer = ts.createPrinter()
      const intermediateCode = printer.printFile(result.transformed[0])

      const transpiled = ts.transpileModule(intermediateCode, {
        compilerOptions: {
          ...program.getCompilerOptions(),
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ESNext,
          noEmit: false,
        },
      })

      return {
        code: transpiled.outputText,
        map: transpiled.sourceMapText
          ? JSON.parse(transpiled.sourceMapText)
          : null,
      }
    },
  } as any
}
