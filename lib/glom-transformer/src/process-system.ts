import ts from "typescript"
import type {ParamQueryInfo} from "./types"
import {getSymbolName, isGlomAllType} from "./type-utils"
import {extractAllTermsFromNode} from "./term-extraction"
import {generateParamDescriptor} from "./descriptor"
import {rewriteSystemFunction} from "./system-rewrite"

export function processSystem(
  systemNode: ts.FunctionExpression | ts.ArrowFunction | ts.FunctionDeclaration,
  context: ts.TransformationContext,
  typeChecker: ts.TypeChecker,
) {
  const params = systemNode.parameters
  const paramDescriptors: ts.Expression[] = []
  const allQueryInfos: ParamQueryInfo[] = []
  let isGlomSystem = false

  const systemName = ts.isFunctionDeclaration(systemNode)
    ? systemNode.name?.text || "anonymous"
    : ts.isVariableDeclaration(systemNode.parent)
      ? systemNode.parent.name.getText()
      : "anonymous"

  for (const param of params) {
    const type = typeChecker.getTypeAtLocation(param)
    const typeNode = param.type
    const actualName = getSymbolName(type)

    const isAll = isGlomAllType(type)
    const isUnique = actualName === "Unique" || !!type.getProperty("__unique")

    if (isAll && typeNode) {
      const terms = extractAllTermsFromNode(
        typeNode,
        context.factory,
        typeChecker,
      )
      if (terms.length > 0) {
        allQueryInfos.push({
          paramName: param.name,
          terms,
          isUnique,
        })
      }
    }

    const desc = generateParamDescriptor(
      typeNode,
      type,
      typeChecker,
      context.factory,
    )
    if (desc) {
      paramDescriptors.push(desc)
      isGlomSystem = true
    } else {
      paramDescriptors.push(context.factory.createObjectLiteralExpression([]))
    }
  }

  if (!isGlomSystem) {
    return {
      isSystem: false,
      transformedNode: systemNode,
      metadataObj: null,
      systemName,
    }
  }

  let transformedNode: ts.Node = systemNode
  if (allQueryInfos.length > 0) {
    transformedNode = rewriteSystemFunction(systemNode, allQueryInfos, context)
  }

  const metadataObj = context.factory.createObjectLiteralExpression(
    [
      context.factory.createPropertyAssignment(
        context.factory.createIdentifier("params"),
        context.factory.createArrayLiteralExpression(paramDescriptors, false),
      ),
      context.factory.createPropertyAssignment(
        context.factory.createIdentifier("name"),
        context.factory.createStringLiteral(systemName),
      ),
    ],
    false,
  )

  return {
    isSystem: true,
    transformedNode,
    metadataObj,
    systemName,
  }
}
