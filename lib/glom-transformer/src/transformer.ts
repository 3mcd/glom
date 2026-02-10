import ts from "typescript"
import {processDefineComponent} from "./process-component"
import {processSystem} from "./process-system"
import {factoryWithMetadata, wrapWithMetadata} from "./metadata"

export type {QueryTerm} from "./types"

export function createTransformer(
  program: ts.Program,
): ts.TransformerFactory<ts.SourceFile> {
  const typeChecker = program.getTypeChecker()

  return (context: ts.TransformationContext) => {
    return (sourceFile: ts.SourceFile) => {
      if (
        sourceFile.isDeclarationFile ||
        sourceFile.fileName.includes("node_modules") ||
        sourceFile.fileName.includes("lib/glom-ecs/src")
      ) {
        return sourceFile
      }
      const visitor = (node: ts.Node): ts.Node => {
        if (ts.isFunctionDeclaration(node)) {
          const {isSystem, transformedNode, metadataObj, systemName} =
            processSystem(node, context, typeChecker)
          if (isSystem) {
            return factoryWithMetadata(
              transformedNode as ts.FunctionDeclaration,
              metadataObj!,
              systemName,
              context.factory,
            )
          }
        }

        if (ts.isVariableStatement(node)) {
          const declarations = node.declarationList.declarations
          if (declarations.length === 1) {
            const decl = declarations[0]!
            if (
              decl.initializer &&
              (ts.isFunctionExpression(decl.initializer) ||
                ts.isArrowFunction(decl.initializer))
            ) {
              const {isSystem, transformedNode, metadataObj, systemName} =
                processSystem(decl.initializer, context, typeChecker)
              if (isSystem) {
                const newDecl = context.factory.updateVariableDeclaration(
                  decl,
                  decl.name,
                  decl.exclamationToken,
                  decl.type,
                  transformedNode as ts.Expression,
                )
                const newStmt = context.factory.updateVariableStatement(
                  node,
                  node.modifiers,
                  context.factory.updateVariableDeclarationList(
                    node.declarationList,
                    [newDecl],
                  ),
                )
                return factoryWithMetadata(
                  newStmt,
                  metadataObj!,
                  systemName,
                  context.factory,
                )
              }
            }
          }
        }

        // Handle anonymous systems inside addSystem(...)
        if (ts.isCallExpression(node)) {
          const name = node.expression.getText()
          if (name.endsWith("addSystem")) {
            const systemArg = node.arguments[1]
            if (
              systemArg &&
              (ts.isFunctionExpression(systemArg) ||
                ts.isArrowFunction(systemArg))
            ) {
              const {isSystem, transformedNode, metadataObj} = processSystem(
                systemArg,
                context,
                typeChecker,
              )
              if (isSystem) {
                const wrapped = wrapWithMetadata(
                  transformedNode as ts.Expression,
                  metadataObj!,
                  context.factory,
                )
                const newArgs = [...node.arguments]
                newArgs[1] = wrapped
                return context.factory.updateCallExpression(
                  node,
                  node.expression,
                  node.typeParameters,
                  newArgs,
                )
              }
            }
          }
        }

        // Auto-generate serde for defineComponent<T>(...) calls.
        // Return directly (no visitEachChild) because the injected serde
        // is fully synthetic and needs no further transformation.
        if (ts.isCallExpression(node)) {
          const transformed = processDefineComponent(
            node,
            typeChecker,
            context.factory,
          )
          if (transformed) {
            return transformed
          }
        }

        return ts.visitEachChild(node, visitor, context)
      }

      return ts.visitNode(sourceFile, visitor) as ts.SourceFile
    }
  }
}
