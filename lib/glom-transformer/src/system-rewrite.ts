import ts from "typescript"
import type {ParamQueryInfo} from "./types"
import {generateLoops, generatePreamble} from "./codegen"

export function rewriteSystemFunction(
  systemNode: ts.FunctionExpression | ts.ArrowFunction | ts.FunctionDeclaration,
  queryInfos: ParamQueryInfo[],
  context: ts.TransformationContext,
): ts.Node {
  const factory = context.factory
  const newBody: ts.Statement[] = []
  const newParams = [...systemNode.parameters]

  queryInfos.forEach((info, _index) => {
    if (info.isUnique) {
      const originalParam = systemNode.parameters.find(
        (p) => p.name === info.paramName,
      )
      if (originalParam) {
        const paramIdx = systemNode.parameters.indexOf(originalParam)
        const uniqueName = factory.createUniqueName("_unique_query")
        newParams[paramIdx] = factory.createParameterDeclaration(
          originalParam.modifiers,
          originalParam.dotDotDotToken,
          uniqueName,
          originalParam.questionToken,
          originalParam.type,
          originalParam.initializer,
        )

        // const [pos] = _unique_query_1.get()
        newBody.push(
          factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList(
              [
                factory.createVariableDeclaration(
                  info.paramName,
                  undefined,
                  undefined,
                  factory.createCallExpression(
                    factory.createPropertyAccessExpression(
                      uniqueName,
                      factory.createIdentifier("get"),
                    ),
                    undefined,
                    [],
                  ),
                ),
              ],
              ts.NodeFlags.Const,
            ),
          ),
        )
      }
    } else {
      newBody.push(
        ...generatePreamble(info.paramName.getText(), info.terms, factory),
      )
    }
  })

  let currentBody: ts.Statement[] = []
  if (ts.isBlock(systemNode.body!)) {
    currentBody = [...systemNode.body.statements]
  } else {
    currentBody = [
      factory.createExpressionStatement(systemNode.body as ts.Expression),
    ]
  }

  const visitor: ts.Visitor = (node: ts.Node): ts.Node | undefined => {
    if (ts.isForOfStatement(node)) {
      if (
        ts.isArrayBindingPattern(node.initializer) ||
        (ts.isVariableDeclarationList(node.initializer) &&
          ts.isArrayBindingPattern(node.initializer.declarations[0]?.name))
      ) {
        const expression = node.expression
        const queryName = expression.getText()
        const info = queryInfos.find((i) => i.paramName.getText() === queryName)

        if (info && !info.isUnique) {
          const bindingPattern = ts.isVariableDeclarationList(node.initializer)
            ? (node.initializer.declarations[0]?.name as ts.ArrayBindingPattern)
            : (node.initializer as ts.ArrayBindingPattern)

          const loopVariables = bindingPattern.elements as ts.BindingElement[]
          const loopBody = ts.isBlock(node.statement)
            ? [...node.statement.statements]
            : [node.statement]

          return factory.createBlock(
            generateLoops(
              queryName,
              info.terms,
              loopVariables,
              loopBody,
              factory,
            ),
            true,
          )
        }
      }
    }

    return ts.visitEachChild(node, visitor, context)
  }

  const visitorResults = ts.visitNodes(
    factory.createNodeArray(currentBody),
    visitor,
  ) as unknown as ts.Statement[]

  const blockBody = factory.createBlock([...newBody, ...visitorResults], true)

  if (ts.isFunctionDeclaration(systemNode)) {
    return factory.updateFunctionDeclaration(
      systemNode,
      systemNode.modifiers,
      systemNode.asteriskToken,
      systemNode.name,
      systemNode.typeParameters,
      newParams,
      systemNode.type,
      blockBody,
    )
  } else if (ts.isFunctionExpression(systemNode)) {
    return factory.updateFunctionExpression(
      systemNode,
      systemNode.modifiers,
      systemNode.asteriskToken,
      systemNode.name,
      systemNode.typeParameters,
      newParams,
      systemNode.type,
      blockBody,
    )
  } else {
    return factory.updateArrowFunction(
      systemNode,
      systemNode.modifiers,
      systemNode.typeParameters,
      newParams,
      systemNode.type,
      systemNode.equalsGreaterThanToken,
      blockBody,
    )
  }
}
