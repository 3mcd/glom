import ts from "typescript"
import type {QueryTerm} from "./types"
import {getSymbolName, isGlomAllType, resolveTypeNode} from "./type-utils"
import {extractAllTermsFromNode, extractRuntimeExpr} from "./term-extraction"

export function generateAllDescriptor(
  terms: QueryTerm[],
  factory: ts.NodeFactory,
  key = "all",
): ts.Expression {
  const generateTerm = (term: QueryTerm): ts.Expression => {
    switch (term.type) {
      case "read":
      case "write":
      case "has":
      case "not":
        return factory.createObjectLiteralExpression([
          factory.createPropertyAssignment(
            term.type,
            term.runtimeExpr || factory.createIdentifier("unknown"),
          ),
        ])
      case "entity":
        return factory.createObjectLiteralExpression([
          factory.createPropertyAssignment("entity", factory.createTrue()),
        ])
      case "rel":
        return factory.createObjectLiteralExpression([
          factory.createPropertyAssignment(
            "rel",
            factory.createArrayLiteralExpression(
              [
                term.runtimeExpr || factory.createIdentifier("unknown"),
                term.subTerms
                  ? term.subTerms.length === 1
                    ? generateTerm(term.subTerms[0]!)
                    : factory.createObjectLiteralExpression([
                        factory.createPropertyAssignment(
                          "all",
                          factory.createArrayLiteralExpression(
                            term.subTerms.map(generateTerm),
                            false,
                          ),
                        ),
                      ])
                  : factory.createObjectLiteralExpression([]),
              ],
              false,
            ),
          ),
        ])
    }
  }

  return factory.createObjectLiteralExpression([
    factory.createPropertyAssignment(
      key,
      factory.createArrayLiteralExpression(terms.map(generateTerm), false),
    ),
  ])
}

export function generateParamDescriptor(
  node: ts.TypeNode | undefined,
  type: ts.Type,
  typeChecker: ts.TypeChecker,
  factory: ts.NodeFactory,
): ts.Expression | null {
  if (!node) return null

  const resolvedNode = resolveTypeNode(node, typeChecker)
  const name = getSymbolName(type)

  if (
    ts.isTypeQueryNode(resolvedNode) ||
    type.getProperty("__component_brand")
  ) {
    const componentExpr = extractRuntimeExpr(factory, resolvedNode)
    if (componentExpr) {
      return factory.createObjectLiteralExpression([
        factory.createPropertyAssignment("read", componentExpr),
      ])
    }
  }

  if (name === "World" || type.getProperty("__world")) {
    return factory.createObjectLiteralExpression([
      factory.createPropertyAssignment("world", factory.createTrue()),
    ])
  }

  if (name === "In" || type.getProperty("__in")) {
    if (ts.isTypeReferenceNode(resolvedNode)) {
      const innerType = resolvedNode.typeArguments?.[0]
      if (innerType) {
        const innerTypeResolved = typeChecker.getTypeAtLocation(innerType)
        const innerName = getSymbolName(innerTypeResolved)
        if (innerName === "Join" || innerTypeResolved.getProperty("__join")) {
          const innerDesc = generateParamDescriptor(
            innerType,
            innerTypeResolved,
            typeChecker,
            factory,
          )
          if (innerDesc) {
            return factory.createObjectLiteralExpression([
              factory.createPropertyAssignment("in", innerDesc),
            ])
          }
        }
      }
    }
    return factory.createObjectLiteralExpression([
      factory.createPropertyAssignment(
        "in",
        generateAllDescriptor(
          extractAllTermsFromNode(resolvedNode, factory, typeChecker),
          factory,
        ),
      ),
    ])
  }

  if (name === "Out" || type.getProperty("__out")) {
    if (ts.isTypeReferenceNode(resolvedNode)) {
      const innerType = resolvedNode.typeArguments?.[0]
      if (innerType) {
        const innerTypeResolved = typeChecker.getTypeAtLocation(innerType)
        const innerName = getSymbolName(innerTypeResolved)
        if (innerName === "Join" || innerTypeResolved.getProperty("__join")) {
          const innerDesc = generateParamDescriptor(
            innerType,
            innerTypeResolved,
            typeChecker,
            factory,
          )
          if (innerDesc) {
            return factory.createObjectLiteralExpression([
              factory.createPropertyAssignment("out", innerDesc),
            ])
          }
        }
      }
    }
    return factory.createObjectLiteralExpression([
      factory.createPropertyAssignment(
        "out",
        generateAllDescriptor(
          extractAllTermsFromNode(resolvedNode, factory, typeChecker),
          factory,
        ),
      ),
    ])
  }

  if (name === "Unique" || type.getProperty("__unique")) {
    return generateAllDescriptor(
      extractAllTermsFromNode(resolvedNode, factory, typeChecker),
      factory,
      "unique",
    )
  }

  if (name === "Join" || type.getProperty("__join")) {
    if (ts.isTypeReferenceNode(resolvedNode)) {
      const leftArg = resolvedNode.typeArguments?.[0]
      const rightArg = resolvedNode.typeArguments?.[1]
      const relArg = resolvedNode.typeArguments?.[2]

      const leftDesc = leftArg
        ? generateParamDescriptor(
            leftArg,
            typeChecker.getTypeAtLocation(leftArg),
            typeChecker,
            factory,
          )
        : null
      const rightDesc = rightArg
        ? generateParamDescriptor(
            rightArg,
            typeChecker.getTypeAtLocation(rightArg),
            typeChecker,
            factory,
          )
        : null
      const relExpr = relArg ? extractRuntimeExpr(factory, relArg) : undefined

      return factory.createObjectLiteralExpression([
        factory.createPropertyAssignment(
          "join",
          factory.createArrayLiteralExpression(
            [
              leftDesc || factory.createObjectLiteralExpression([]),
              rightDesc || factory.createObjectLiteralExpression([]),
              relExpr || factory.createIdentifier("undefined"),
            ],
            false,
          ),
        ),
      ])
    }
  }

  if (isGlomAllType(type)) {
    return generateAllDescriptor(
      extractAllTermsFromNode(resolvedNode, factory, typeChecker),
      factory,
    )
  }

  if (ts.isTypeReferenceNode(resolvedNode)) {
    const typeName = resolvedNode.typeName
    const nodeName = ts.isIdentifier(typeName)
      ? typeName.text
      : ts.isQualifiedName(typeName)
        ? typeName.right.text
        : ""

    switch (nodeName) {
      case "Read":
      case "Write":
      case "Add":
      case "Remove":
      case "Has":
      case "Not":
        return factory.createObjectLiteralExpression([
          factory.createPropertyAssignment(
            nodeName.toLowerCase(),
            extractRuntimeExpr(factory, resolvedNode.typeArguments?.[0]) ||
              factory.createIdentifier("unknown"),
          ),
        ])
      case "Spawn":
        return factory.createObjectLiteralExpression([
          factory.createPropertyAssignment(
            "spawn",
            extractRuntimeExpr(factory, resolvedNode.typeArguments?.[0]) ||
              factory.createTrue(),
          ),
        ])
      case "Despawn":
        return factory.createObjectLiteralExpression([
          factory.createPropertyAssignment("despawn", factory.createTrue()),
        ])
      case "Entity":
      case "EntityTerm":
        return factory.createObjectLiteralExpression([
          factory.createPropertyAssignment("entity", factory.createTrue()),
        ])
    }
  }

  return null
}
