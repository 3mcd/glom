import ts from "typescript"

export function createTransformer(
  program: ts.Program,
): ts.TransformerFactory<ts.SourceFile> {
  const typeChecker = program.getTypeChecker()

  return (context: ts.TransformationContext) => {
    return (sourceFile: ts.SourceFile) => {
      const visitor: ts.Visitor = (
        node: ts.Node,
      ): ts.Node | ts.Node[] | undefined => {
        if (ts.isVariableStatement(node)) {
          const newDeclarations: ts.VariableDeclaration[] = []
          const metadataStatements: ts.Statement[] = []
          let transformed = false

          for (const decl of node.declarationList.declarations) {
            if (
              decl.initializer &&
              (ts.isArrowFunction(decl.initializer) ||
                ts.isFunctionExpression(decl.initializer))
            ) {
              const name = ts.isIdentifier(decl.name)
                ? decl.name.text
                : undefined
              const result = transformSystem(
                decl.initializer,
                typeChecker,
                context,
                name,
              )

              if (result.isSystem) {
                newDeclarations.push(
                  ts.factory.updateVariableDeclaration(
                    decl,
                    decl.name,
                    decl.exclamationToken,
                    decl.type,
                    result.transformedNode as ts.Expression,
                  ),
                )
                if (name && result.metadataObj) {
                  metadataStatements.push(
                    createMetadataStatement(
                      context.factory,
                      name,
                      result.metadataObj,
                    ),
                  )
                }
                transformed = true
                continue
              }
            }
            newDeclarations.push(decl)
          }

          if (transformed) {
            const updatedStatement = ts.factory.updateVariableStatement(
              node,
              node.modifiers,
              ts.factory.updateVariableDeclarationList(
                node.declarationList,
                newDeclarations,
              ),
            )
            return [updatedStatement, ...metadataStatements]
          }
        }

        if (ts.isFunctionDeclaration(node)) {
          const name = node.name?.text
          const result = transformSystem(node, typeChecker, context, name)
          if (result.isSystem) {
            const metadataStatements: ts.Statement[] = []
            if (name && result.metadataObj) {
              metadataStatements.push(
                createMetadataStatement(
                  context.factory,
                  name,
                  result.metadataObj,
                ),
              )
            }
            return [
              result.transformedNode as ts.FunctionDeclaration,
              ...metadataStatements,
            ]
          }
        }

        if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
          const result = transformSystem(node, typeChecker, context)
          if (result.isSystem) {
            return wrapWithMetadata(
              context.factory,
              result.transformedNode as ts.Expression,
              result.metadataObj,
            )
          }
        }

        return ts.visitEachChild(node, visitor, context)
      }

      return ts.visitNode(sourceFile, visitor) as ts.SourceFile
    }
  }
}

interface QueryTerm {
  type: "read" | "write" | "has" | "not" | "rel" | "entity"
  storeIndex?: number
  joinIndex: number
  subTerms?: QueryTerm[]
  runtimeExpr?: ts.Expression
}

interface TransformationResult {
  isSystem: boolean
  transformedNode: ts.Node
  metadataObj: ts.ObjectLiteralExpression | null
  systemName: string
}

interface ParamQueryInfo {
  paramName: string
  terms: QueryTerm[]
}

function transformSystem(
  systemNode: ts.FunctionExpression | ts.ArrowFunction | ts.FunctionDeclaration,
  typeChecker: ts.TypeChecker,
  context: ts.TransformationContext,
  nameHint?: string,
): TransformationResult {
  const signature = typeChecker.getSignatureFromDeclaration(systemNode)
  if (!signature)
    return {
      isSystem: false,
      transformedNode: systemNode,
      metadataObj: null,
      systemName: "",
    }

  const params = signature.getParameters()
  if (params.length === 0)
    return {
      isSystem: false,
      transformedNode: systemNode,
      metadataObj: null,
      systemName: "",
    }

  const allQueryInfos: ParamQueryInfo[] = []

  const systemName =
    nameHint ||
    (ts.isFunctionDeclaration(systemNode) && systemNode.name
      ? systemNode.name.text
      : ts.isFunctionExpression(systemNode) && systemNode.name
        ? systemNode.name.text
        : "anonymous_system")

  const paramDescriptors: ts.Expression[] = []
  let isGlomSystem = false

  for (let i = 0; i < systemNode.parameters.length; i++) {
    const param = systemNode.parameters[i]
    const typeNode = param.type
    const type = typeChecker.getTypeOfSymbolAtLocation(params[i], systemNode)
    const isAll = isGlomAllType(type)

    if (isAll && typeNode && ts.isTypeReferenceNode(typeNode)) {
      const terms = extractAllTermsFromNode(typeNode, context.factory)
      if (terms.length > 0) {
        if (ts.isIdentifier(param.name)) {
          allQueryInfos.push({
            paramName: param.name.text,
            terms,
          })
        }
        paramDescriptors.push(generateAllDescriptor(terms, context.factory))
        isGlomSystem = true
        continue
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

  return {isSystem: true, transformedNode, metadataObj, systemName}
}

function createMetadataStatement(
  factory: ts.NodeFactory,
  name: string,
  metadataObj: ts.ObjectLiteralExpression,
): ts.Statement {
  return factory.createExpressionStatement(
    factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("Object"),
        factory.createIdentifier("defineProperty"),
      ),
      undefined,
      [
        factory.createIdentifier(name),
        factory.createStringLiteral("__system_desc"),
        factory.createObjectLiteralExpression(
          [
            factory.createPropertyAssignment(
              factory.createIdentifier("value"),
              metadataObj,
            ),
            factory.createPropertyAssignment(
              factory.createIdentifier("enumerable"),
              factory.createFalse(),
            ),
            factory.createPropertyAssignment(
              factory.createIdentifier("configurable"),
              factory.createTrue(),
            ),
          ],
          false,
        ),
      ],
    ),
  )
}

function wrapWithMetadata(
  factory: ts.NodeFactory,
  expr: ts.Expression,
  metadataObj: ts.ObjectLiteralExpression | null,
): ts.Expression {
  if (!metadataObj) return expr
  return factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createIdentifier("Object"),
      factory.createIdentifier("defineProperty"),
    ),
    undefined,
    [
      expr,
      factory.createStringLiteral("__system_desc"),
      factory.createObjectLiteralExpression(
        [
          factory.createPropertyAssignment(
            factory.createIdentifier("value"),
            metadataObj,
          ),
          factory.createPropertyAssignment(
            factory.createIdentifier("enumerable"),
            factory.createFalse(),
          ),
          factory.createPropertyAssignment(
            factory.createIdentifier("configurable"),
            factory.createTrue(),
          ),
        ],
        false,
      ),
    ],
  )
}

function isGlomAllType(type: ts.Type): boolean {
  if (type.getProperty("__all")) return true
  const symbol = type.getSymbol() || type.aliasSymbol
  if (!symbol) return false
  if (symbol.getName() === "All") return true

  const target = (type as {target?: ts.Type}).target
  if (target) {
    const targetSymbol = target.getSymbol() || target.aliasSymbol
    if (targetSymbol && targetSymbol.getName() === "All") return true
  }
  return false
}

function extractAllTermsFromNode(
  typeNode: ts.TypeReferenceNode,
  factory: ts.NodeFactory,
): QueryTerm[] {
  const terms: QueryTerm[] = []
  let storeIndex = 0
  let joinIndex = 0

  const extractTerm = (
    node: ts.TypeNode,
    currentJoinIndex: number,
  ): QueryTerm | undefined => {
    if (!ts.isTypeReferenceNode(node)) return undefined

    const typeName = node.typeName
    const name = ts.isIdentifier(typeName)
      ? typeName.text
      : ts.isQualifiedName(typeName)
        ? typeName.right.text
        : ""

    if (name === "Read" || name === "Write") {
      const componentExpr = extractRuntimeExpr(factory, node.typeArguments?.[0])
      return {
        type: name === "Read" ? "read" : "write",
        storeIndex: storeIndex++,
        joinIndex: currentJoinIndex,
        runtimeExpr: componentExpr,
      }
    }

    if (name === "Has" || name === "Not") {
      const componentExpr = extractRuntimeExpr(factory, node.typeArguments?.[0])
      return {
        type: name === "Has" ? "has" : "not",
        joinIndex: currentJoinIndex,
        runtimeExpr: componentExpr,
      }
    }

    if (name === "Entity" || name === "EntityTerm") {
      return {
        type: "entity",
        joinIndex: currentJoinIndex,
      }
    }

    if (name === "Rel") {
      const relExpr = extractRuntimeExpr(factory, node.typeArguments?.[0])
      const nextJoinIndex = ++joinIndex
      const subTerm = node.typeArguments?.[1]
        ? extractTerm(node.typeArguments[1], nextJoinIndex)
        : undefined
      return {
        type: "rel",
        joinIndex: currentJoinIndex,
        runtimeExpr: relExpr,
        subTerms: subTerm ? [subTerm] : [],
      }
    }

    return undefined
  }

  if (typeNode.typeArguments) {
    for (const arg of typeNode.typeArguments) {
      const term = extractTerm(arg, 0)
      if (term) terms.push(term)
    }
  }

  return terms
}

function entityNameToExpression(
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

function extractRuntimeExpr(
  factory: ts.NodeFactory,
  node: ts.TypeNode | undefined,
): ts.Expression | undefined {
  if (!node) return undefined
  if (ts.isTypeQueryNode(node)) {
    return entityNameToExpression(factory, node.exprName)
  }
  return undefined
}

function generateAllDescriptor(
  terms: QueryTerm[],
  factory: ts.NodeFactory,
): ts.Expression {
  const generateTerm = (term: QueryTerm): ts.Expression => {
    switch (term.type) {
      case "read":
        return factory.createObjectLiteralExpression([
          factory.createPropertyAssignment(
            "read",
            term.runtimeExpr || factory.createIdentifier("unknown"),
          ),
        ])
      case "write":
        return factory.createObjectLiteralExpression([
          factory.createPropertyAssignment(
            "write",
            term.runtimeExpr || factory.createIdentifier("unknown"),
          ),
        ])
      case "has":
        return factory.createObjectLiteralExpression([
          factory.createPropertyAssignment(
            "has",
            term.runtimeExpr || factory.createIdentifier("unknown"),
          ),
        ])
      case "not":
        return factory.createObjectLiteralExpression([
          factory.createPropertyAssignment(
            "not",
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
            factory.createArrayLiteralExpression([
              term.runtimeExpr || factory.createIdentifier("unknown"),
              term.subTerms?.[0]
                ? generateTerm(term.subTerms[0])
                : factory.createObjectLiteralExpression([]),
            ]),
          ),
        ])
    }
  }

  return factory.createObjectLiteralExpression([
    factory.createPropertyAssignment(
      "all",
      factory.createArrayLiteralExpression(terms.map(generateTerm)),
    ),
  ])
}

function generateParamDescriptor(
  node: ts.TypeNode | undefined,
  type: ts.Type,
  typeChecker: ts.TypeChecker,
  factory: ts.NodeFactory,
): ts.Expression | null {
  if (!node || !ts.isTypeReferenceNode(node)) {
    const symbol = type.getSymbol() || type.aliasSymbol
    if (symbol?.getName() === "World") {
      return factory.createObjectLiteralExpression([
        factory.createPropertyAssignment("world", factory.createTrue()),
      ])
    }
    return null
  }

  const typeName = node.typeName
  const name = ts.isIdentifier(typeName)
    ? typeName.text
    : ts.isQualifiedName(typeName)
      ? typeName.right.text
      : ""

  switch (name) {
    case "Read":
      return factory.createObjectLiteralExpression([
        factory.createPropertyAssignment(
          "read",
          extractRuntimeExpr(factory, node.typeArguments?.[0]) ||
            factory.createIdentifier("unknown"),
        ),
      ])
    case "Write":
      return factory.createObjectLiteralExpression([
        factory.createPropertyAssignment(
          "write",
          extractRuntimeExpr(factory, node.typeArguments?.[0]) ||
            factory.createIdentifier("unknown"),
        ),
      ])
    case "Add":
      return factory.createObjectLiteralExpression([
        factory.createPropertyAssignment(
          "add",
          extractRuntimeExpr(factory, node.typeArguments?.[0]) ||
            factory.createIdentifier("unknown"),
        ),
      ])
    case "Remove":
      return factory.createObjectLiteralExpression([
        factory.createPropertyAssignment(
          "remove",
          extractRuntimeExpr(factory, node.typeArguments?.[0]) ||
            factory.createIdentifier("unknown"),
        ),
      ])
    case "Has":
      return factory.createObjectLiteralExpression([
        factory.createPropertyAssignment(
          "has",
          extractRuntimeExpr(factory, node.typeArguments?.[0]) ||
            factory.createIdentifier("unknown"),
        ),
      ])
    case "Not":
      return factory.createObjectLiteralExpression([
        factory.createPropertyAssignment(
          "not",
          extractRuntimeExpr(factory, node.typeArguments?.[0]) ||
            factory.createIdentifier("unknown"),
        ),
      ])
    case "Spawn":
      return factory.createObjectLiteralExpression([
        factory.createPropertyAssignment("spawn", factory.createTrue()),
      ])
    case "Despawn":
      return factory.createObjectLiteralExpression([
        factory.createPropertyAssignment("despawn", factory.createTrue()),
      ])
    case "World":
      return factory.createObjectLiteralExpression([
        factory.createPropertyAssignment("world", factory.createTrue()),
      ])
    default: {
      const symbol = typeChecker.getSymbolAtLocation(typeName)
      if (symbol?.getName() === "World") {
        return factory.createObjectLiteralExpression([
          factory.createPropertyAssignment("world", factory.createTrue()),
        ])
      }
      return null
    }
  }
}

function rewriteSystemFunction(
  fn: ts.FunctionExpression | ts.ArrowFunction | ts.FunctionDeclaration,
  queryInfos: ParamQueryInfo[],
  context: ts.TransformationContext,
): ts.FunctionExpression | ts.ArrowFunction | ts.FunctionDeclaration {
  const {factory} = context

  const originalBody = fn.body
  if (!originalBody || !ts.isBlock(originalBody)) return fn

  const queryMap = new Map(queryInfos.map((q) => [q.paramName, q.terms]))
  const usedQueries = new Set<string>()

  const visitor = (node: ts.Node): ts.Node => {
    if (ts.isForOfStatement(node)) {
      const expression = node.expression
      if (ts.isIdentifier(expression)) {
        const terms = queryMap.get(expression.text)
        if (terms) {
          usedQueries.add(expression.text)

          let loopVariables: ts.BindingElement[] = []
          if (ts.isVariableDeclarationList(node.initializer)) {
            const decl = node.initializer.declarations[0]
            if (decl && ts.isArrayBindingPattern(decl.name)) {
              loopVariables = [
                ...decl.name.elements.filter(ts.isBindingElement),
              ]
            }
          }

          let loopBody: ts.Statement[] = []
          if (ts.isBlock(node.statement)) {
            loopBody = [...node.statement.statements]
          } else {
            loopBody = [node.statement]
          }

          if (loopBody.length > 0) {
            return factory.createBlock(
              generateLoops(
                expression.text,
                terms,
                loopVariables,
                loopBody,
                factory,
              ),
              true,
            )
          }
        }
      }
    }
    return ts.visitEachChild(node, visitor, context)
  }

  const updatedBody = ts.visitNode(originalBody, visitor) as ts.Block

  const preambles: ts.Statement[] = []
  usedQueries.forEach((paramName) => {
    const terms = queryMap.get(paramName)!
    preambles.push(...generatePreamble(paramName, terms, factory))
  })

  const finalBody = factory.createBlock(
    [...preambles, ...updatedBody.statements],
    true,
  )

  if (ts.isArrowFunction(fn)) {
    return factory.updateArrowFunction(
      fn,
      fn.modifiers,
      fn.typeParameters,
      fn.parameters,
      fn.type,
      fn.equalsGreaterThanToken,
      finalBody,
    )
  } else if (ts.isFunctionExpression(fn)) {
    return factory.updateFunctionExpression(
      fn,
      fn.modifiers,
      fn.asteriskToken,
      fn.name,
      fn.typeParameters,
      fn.parameters,
      fn.type,
      finalBody,
    )
  } else {
    return factory.updateFunctionDeclaration(
      fn,
      fn.modifiers,
      fn.asteriskToken,
      fn.name,
      fn.typeParameters,
      fn.parameters,
      fn.type,
      finalBody,
    )
  }
}

function flattenTerms(terms: QueryTerm[]): QueryTerm[] {
  const result: QueryTerm[] = []
  const visit = (t: QueryTerm) => {
    result.push(t)
    if (t.subTerms) {
      t.subTerms.forEach(visit)
    }
  }
  terms.forEach(visit)
  return result
}

function generatePreamble(
  queryParamName: string,
  terms: QueryTerm[],
  factory: ts.NodeFactory,
): ts.Statement[] {
  const preamble: ts.Statement[] = []
  const allTerms = flattenTerms(terms)

  preamble.push(
    factory.createVariableStatement(
      undefined,
      factory.createVariableDeclarationList(
        [
          factory.createVariableDeclaration(
            factory.createIdentifier(`_e_to_i_${queryParamName}`),
            undefined,
            undefined,
            factory.createPropertyAccessExpression(
              factory.createIdentifier(queryParamName),
              factory.createIdentifier("entity_to_index"),
            ),
          ),
        ],
        ts.NodeFlags.Const,
      ),
    ),
  )

  allTerms.forEach((t) => {
    if (t.storeIndex !== undefined) {
      preamble.push(
        factory.createVariableStatement(
          undefined,
          factory.createVariableDeclarationList(
            [
              factory.createVariableDeclaration(
                factory.createIdentifier(
                  `_store${t.storeIndex}_${queryParamName}`,
                ),
                undefined,
                undefined,
                factory.createElementAccessExpression(
                  factory.createPropertyAccessExpression(
                    factory.createIdentifier(queryParamName),
                    factory.createIdentifier("stores"),
                  ),
                  factory.createNumericLiteral(t.storeIndex),
                ),
              ),
            ],
            ts.NodeFlags.Const,
          ),
        ),
      )
    }
  })

  const joinCount =
    allTerms.reduce((max, t) => Math.max(max, t.joinIndex), 0) + 1
  for (let i = 0; i < joinCount; i++) {
    preamble.push(
      factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList(
          [
            factory.createVariableDeclaration(
              factory.createIdentifier(`_q${i}_${queryParamName}`),
              undefined,
              undefined,
              factory.createElementAccessExpression(
                factory.createPropertyAccessExpression(
                  factory.createIdentifier(queryParamName),
                  factory.createIdentifier("joins"),
                ),
                factory.createNumericLiteral(i),
              ),
            ),
          ],
          ts.NodeFlags.Const,
        ),
      ),
    )
  }

  return preamble
}

function generateLoops(
  queryParamName: string,
  terms: QueryTerm[],
  loopVariables: ts.BindingElement[],
  loopBody: ts.Statement[],
  factory: ts.NodeFactory,
): ts.Statement[] {
  const allTerms = flattenTerms(terms)
  const joinCount =
    allTerms.reduce((max, t) => Math.max(max, t.joinIndex), 0) + 1

  function generateRecursive(
    currentJoinLevel: number,
    currentSubjectEnt: ts.Identifier | undefined,
  ): ts.Statement[] {
    const nIdent = factory.createIdentifier(
      `_n${currentJoinLevel}_${queryParamName}`,
    )
    const iIdent = factory.createIdentifier(
      `_i${currentJoinLevel}_${queryParamName}`,
    )
    const jIdent = factory.createIdentifier(
      `_j${currentJoinLevel}_${queryParamName}`,
    )
    const idxIdent = factory.createIdentifier(
      `_idx${currentJoinLevel}_${queryParamName}`,
    )
    const eIdent = factory.createIdentifier(
      `_e${currentJoinLevel}_${queryParamName}`,
    )
    const qIdent = factory.createIdentifier(
      `_q${currentJoinLevel}_${queryParamName}`,
    )
    const eToIIdent = factory.createIdentifier(`_e_to_i_${queryParamName}`)

    let innerBody: ts.Statement[] = []

    if (currentJoinLevel === joinCount - 1) {
      const varMappings: ts.Statement[] = []
      loopVariables.forEach((v, i) => {
        let term = terms[i]
        if (!term) return

        while (term.type === "rel" && term.subTerms && term.subTerms[0]) {
          term = term.subTerms[0]
        }

        const level = term.joinIndex
        const targetEnt = factory.createIdentifier(
          `_e${level}_${queryParamName}`,
        )
        const targetIdx =
          level === 0
            ? factory.createIdentifier(`_idx${level}_${queryParamName}`)
            : factory.createElementAccessExpression(
                factory.createPropertyAccessExpression(
                  eToIIdent,
                  factory.createIdentifier("dense"),
                ),
                factory.createCallExpression(
                  factory.createPropertyAccessExpression(
                    factory.createPropertyAccessExpression(
                      eToIIdent,
                      factory.createIdentifier("sparse"),
                    ),
                    factory.createIdentifier("get"),
                  ),
                  undefined,
                  [targetEnt],
                ),
              )

        const valExpr =
          term.storeIndex !== undefined
            ? factory.createElementAccessExpression(
                factory.createIdentifier(
                  `_store${term.storeIndex}_${queryParamName}`,
                ),
                targetIdx,
              )
            : targetEnt

        if (ts.isIdentifier(v.name)) {
          varMappings.push(
            factory.createVariableStatement(
              undefined,
              factory.createVariableDeclarationList(
                [
                  factory.createVariableDeclaration(
                    v.name.text,
                    undefined,
                    undefined,
                    valExpr,
                  ),
                ],
                ts.NodeFlags.Const,
              ),
            ),
          )
        }
      })
      innerBody = [...varMappings, ...loopBody]
    } else {
      innerBody = generateRecursive(currentJoinLevel + 1, eIdent)
    }

    const entityIteration = factory.createForStatement(
      factory.createVariableDeclarationList(
        [
          factory.createVariableDeclaration(
            jIdent,
            undefined,
            undefined,
            factory.createNumericLiteral(0),
          ),
        ],
        ts.NodeFlags.Let,
      ),
      factory.createBinaryExpression(
        jIdent,
        ts.SyntaxKind.LessThanToken,
        factory.createPropertyAccessExpression(
          factory.createPropertyAccessExpression(
            factory.createPropertyAccessExpression(
              nIdent,
              factory.createIdentifier("entities"),
            ),
            factory.createIdentifier("dense"),
          ),
          factory.createIdentifier("length"),
        ),
      ),
      factory.createPostfixUnaryExpression(jIdent, ts.SyntaxKind.PlusPlusToken),
      factory.createBlock(
        [
          factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList(
              [
                factory.createVariableDeclaration(
                  eIdent,
                  undefined,
                  undefined,
                  factory.createElementAccessExpression(
                    factory.createPropertyAccessExpression(
                      factory.createPropertyAccessExpression(
                        nIdent,
                        factory.createIdentifier("entities"),
                      ),
                      factory.createIdentifier("dense"),
                    ),
                    jIdent,
                  ),
                ),
              ],
              ts.NodeFlags.Const,
            ),
          ),
          factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList(
              [
                factory.createVariableDeclaration(
                  idxIdent,
                  undefined,
                  undefined,
                  factory.createElementAccessExpression(
                    factory.createPropertyAccessExpression(
                      nIdent,
                      factory.createIdentifier("indices"),
                    ),
                    jIdent,
                  ),
                ),
              ],
              ts.NodeFlags.Const,
            ),
          ),
          ...innerBody,
        ],
        true,
      ),
    )

    if (currentJoinLevel > 0 && currentSubjectEnt) {
      const relIdent = factory.createIdentifier(
        `_rel${currentJoinLevel}_${queryParamName}`,
      )
      const targetsIdent = factory.createIdentifier(
        `_targets${currentJoinLevel}_${queryParamName}`,
      )
      const joinOnIdIdent = factory.createPropertyAccessExpression(
        factory.createPropertyAccessExpression(
          qIdent,
          factory.createIdentifier("join_on"),
        ),
        factory.createIdentifier("id"),
      )

      const objectsIdxIdent = factory.createIdentifier(
        `_objects_idx${currentJoinLevel}_${queryParamName}`,
      )

      const relTargetsIdent = factory.createIdentifier(
        `_rel_targets${currentJoinLevel}_${queryParamName}`,
      )

      return [
        factory.createForStatement(
          factory.createVariableDeclarationList(
            [
              factory.createVariableDeclaration(
                iIdent,
                undefined,
                undefined,
                factory.createNumericLiteral(0),
              ),
            ],
            ts.NodeFlags.Let,
          ),
          factory.createBinaryExpression(
            iIdent,
            ts.SyntaxKind.LessThanToken,
            factory.createPropertyAccessExpression(
              factory.createPropertyAccessExpression(
                qIdent,
                factory.createIdentifier("nodes"),
              ),
              factory.createIdentifier("length"),
            ),
          ),
          factory.createPostfixUnaryExpression(
            iIdent,
            ts.SyntaxKind.PlusPlusToken,
          ),
          factory.createBlock(
            [
              factory.createVariableStatement(
                undefined,
                factory.createVariableDeclarationList(
                  [
                    factory.createVariableDeclaration(
                      nIdent,
                      undefined,
                      undefined,
                      factory.createElementAccessExpression(
                        factory.createPropertyAccessExpression(
                          qIdent,
                          factory.createIdentifier("nodes"),
                        ),
                        iIdent,
                      ),
                    ),
                  ],
                  ts.NodeFlags.Const,
                ),
              ),
              factory.createVariableStatement(
                undefined,
                factory.createVariableDeclarationList(
                  [
                    factory.createVariableDeclaration(
                      relIdent,
                      undefined,
                      undefined,
                      factory.createElementAccessExpression(
                        factory.createPropertyAccessExpression(
                          nIdent,
                          factory.createIdentifier("rel_maps"),
                        ),
                        joinOnIdIdent,
                      ),
                    ),
                  ],
                  ts.NodeFlags.Const,
                ),
              ),
              factory.createIfStatement(
                factory.createPrefixUnaryExpression(
                  ts.SyntaxKind.ExclamationToken,
                  relIdent,
                ),
                factory.createContinueStatement(),
              ),
              factory.createVariableStatement(
                undefined,
                factory.createVariableDeclarationList(
                  [
                    factory.createVariableDeclaration(
                      relTargetsIdent,
                      undefined,
                      undefined,
                      factory.createCallExpression(
                        factory.createPropertyAccessExpression(
                          factory.createPropertyAccessExpression(
                            relIdent,
                            factory.createIdentifier("subject_to_objects"),
                          ),
                          factory.createIdentifier("get"),
                        ),
                        undefined,
                        [currentSubjectEnt],
                      ),
                    ),
                  ],
                  ts.NodeFlags.Const,
                ),
              ),
              factory.createIfStatement(
                factory.createPrefixUnaryExpression(
                  ts.SyntaxKind.ExclamationToken,
                  relTargetsIdent,
                ),
                factory.createContinueStatement(),
              ),
              factory.createVariableStatement(
                undefined,
                factory.createVariableDeclarationList(
                  [
                    factory.createVariableDeclaration(
                      targetsIdent,
                      undefined,
                      undefined,
                      factory.createPropertyAccessExpression(
                        relTargetsIdent,
                        factory.createIdentifier("dense"),
                      ),
                    ),
                  ],
                  ts.NodeFlags.Const,
                ),
              ),
              factory.createForStatement(
                factory.createVariableDeclarationList(
                  [
                    factory.createVariableDeclaration(
                      jIdent,
                      undefined,
                      undefined,
                      factory.createNumericLiteral(0),
                    ),
                  ],
                  ts.NodeFlags.Let,
                ),
                factory.createBinaryExpression(
                  jIdent,
                  ts.SyntaxKind.LessThanToken,
                  factory.createPropertyAccessExpression(
                    targetsIdent,
                    factory.createIdentifier("length"),
                  ),
                ),
                factory.createPostfixUnaryExpression(
                  jIdent,
                  ts.SyntaxKind.PlusPlusToken,
                ),
                factory.createBlock(
                  [
                    factory.createVariableStatement(
                      undefined,
                      factory.createVariableDeclarationList(
                        [
                          factory.createVariableDeclaration(
                            eIdent,
                            undefined,
                            undefined,
                            factory.createElementAccessExpression(
                              targetsIdent,
                              jIdent,
                            ),
                          ),
                        ],
                        ts.NodeFlags.Const,
                      ),
                    ),
                    ...(currentJoinLevel === joinCount - 1
                      ? innerBody
                      : generateRecursive(currentJoinLevel + 1, eIdent)),
                  ],
                  true,
                ),
              ),
            ],
            true,
          ),
        ),
      ]
    } else {
      return [
        factory.createForStatement(
          factory.createVariableDeclarationList(
            [
              factory.createVariableDeclaration(
                iIdent,
                undefined,
                undefined,
                factory.createNumericLiteral(0),
              ),
            ],
            ts.NodeFlags.Let,
          ),
          factory.createBinaryExpression(
            iIdent,
            ts.SyntaxKind.LessThanToken,
            factory.createPropertyAccessExpression(
              factory.createPropertyAccessExpression(
                qIdent,
                factory.createIdentifier("nodes"),
              ),
              factory.createIdentifier("length"),
            ),
          ),
          factory.createPostfixUnaryExpression(
            iIdent,
            ts.SyntaxKind.PlusPlusToken,
          ),
          factory.createBlock(
            [
              factory.createVariableStatement(
                undefined,
                factory.createVariableDeclarationList(
                  [
                    factory.createVariableDeclaration(
                      nIdent,
                      undefined,
                      undefined,
                      factory.createElementAccessExpression(
                        factory.createPropertyAccessExpression(
                          qIdent,
                          factory.createIdentifier("nodes"),
                        ),
                        iIdent,
                      ),
                    ),
                  ],
                  ts.NodeFlags.Const,
                ),
              ),
              entityIteration,
            ],
            true,
          ),
        ),
      ]
    }
  }

  return generateRecursive(0, undefined)
}
