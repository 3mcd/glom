import ts from "typescript"
import type {QueryTerm} from "./types"
import {getSymbolName, resolveTypeNode} from "./type-utils"

export function entityNameToExpression(
  factory: ts.NodeFactory,
  name: ts.EntityName,
): ts.Expression {
  if (ts.isIdentifier(name)) {
    return factory.createIdentifier(name.text)
  }
  return factory.createPropertyAccessExpression(
    entityNameToExpression(factory, name.left),
    name.right,
  )
}

export function extractRuntimeExpr(
  factory: ts.NodeFactory,
  node: ts.TypeNode | undefined,
): ts.Expression | undefined {
  if (!node) return undefined
  if (ts.isTypeQueryNode(node)) {
    return entityNameToExpression(factory, node.exprName)
  }
  if (ts.isTypeReferenceNode(node)) {
    return entityNameToExpression(factory, node.typeName)
  }
  return undefined
}

export function extractAllTermsFromNode(
  typeNode: ts.TypeNode,
  factory: ts.NodeFactory,
  typeChecker: ts.TypeChecker,
): QueryTerm[] {
  let storeIndex = 0
  let joinIndex = 0

  const extractTerm = (
    node: ts.TypeNode,
    currentJoinIndex: number,
  ): QueryTerm | QueryTerm[] | undefined => {
    const resolvedNode = resolveTypeNode(node, typeChecker)
    const type = typeChecker.getTypeAtLocation(resolvedNode)
    const name = getSymbolName(type)

    if (ts.isTypeReferenceNode(resolvedNode)) {
      if (name === "Join" || type.getProperty("__join")) {
        const leftArg = resolvedNode.typeArguments?.[0]
        const rightArg = resolvedNode.typeArguments?.[1]

        const leftTerms = leftArg
          ? extractTerm(leftArg, currentJoinIndex)
          : undefined
        const nextJoinIndex = ++joinIndex
        const rightTerms = rightArg
          ? extractTerm(rightArg, nextJoinIndex)
          : undefined

        const results: QueryTerm[] = []
        if (Array.isArray(leftTerms)) results.push(...leftTerms)
        else if (leftTerms) results.push(leftTerms)

        if (Array.isArray(rightTerms)) results.push(...rightTerms)
        else if (rightTerms) results.push(rightTerms)

        return results
      }

      if (
        name === "All" ||
        name === "In" ||
        name === "Out" ||
        name === "Unique" ||
        type.getProperty("__all") ||
        type.getProperty("__in") ||
        type.getProperty("__out") ||
        type.getProperty("__unique")
      ) {
        const results: QueryTerm[] = []
        if (resolvedNode.typeArguments) {
          for (const arg of resolvedNode.typeArguments) {
            const term = extractTerm(arg, currentJoinIndex)
            if (Array.isArray(term)) results.push(...term)
            else if (term) results.push(term)
          }
        }
        return results
      }

      // Check syntax-based type name for conditional types like Read/Write
      // that lose their symbol name when resolved
      const syntaxName = ts.isTypeReferenceNode(resolvedNode)
        ? ts.isIdentifier(resolvedNode.typeName)
          ? resolvedNode.typeName.text
          : ts.isQualifiedName(resolvedNode.typeName)
            ? resolvedNode.typeName.right.text
            : undefined
        : undefined

      if (
        name === "Read" ||
        name === "Write" ||
        syntaxName === "Read" ||
        syntaxName === "Write"
      ) {
        const isWrite = name === "Write" || syntaxName === "Write"
        const componentExpr = extractRuntimeExpr(
          factory,
          resolvedNode.typeArguments?.[0],
        )
        return {
          type: isWrite ? "write" : "read",
          storeIndex: storeIndex++,
          joinIndex: currentJoinIndex,
          runtimeExpr: componentExpr,
        }
      }

      if (
        name === "Has" ||
        name === "Not" ||
        syntaxName === "Has" ||
        syntaxName === "Not"
      ) {
        const isNot = name === "Not" || syntaxName === "Not"
        const componentExpr = extractRuntimeExpr(
          factory,
          resolvedNode.typeArguments?.[0],
        )
        return {
          type: isNot ? "not" : "has",
          joinIndex: currentJoinIndex,
          runtimeExpr: componentExpr,
        }
      }

      if (
        name === "Entity" ||
        name === "EntityTerm" ||
        syntaxName === "Entity" ||
        syntaxName === "EntityTerm"
      ) {
        return {
          type: "entity",
          joinIndex: currentJoinIndex,
        }
      }
    }

    const componentExpr = extractRuntimeExpr(factory, resolvedNode)
    if (componentExpr) {
      if (
        type.getProperty("__component_brand") ||
        ts.isTypeQueryNode(resolvedNode) ||
        (name === "Component" &&
          !["Read", "Write", "Has", "Not", "Entity", "EntityTerm"].includes(
            name || "",
          ))
      ) {
        return {
          type: "read",
          storeIndex: storeIndex++,
          joinIndex: currentJoinIndex,
          runtimeExpr: componentExpr,
        }
      }
    }

    return undefined
  }

  const terms = extractTerm(typeNode, 0)
  if (Array.isArray(terms)) return terms
  if (terms) return [terms]
  return []
}
