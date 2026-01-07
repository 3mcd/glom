import ts from "typescript"

export type QueryTerm =
  | {
      type: "read"
      component: any
      storeIndex: number
      joinIndex: number
      runtimeExpr?: ts.Expression
    }
  | {
      type: "write"
      component: any
      storeIndex: number
      joinIndex: number
      runtimeExpr?: ts.Expression
    }
  | {
      type: "has"
      component: any
      joinIndex: number
      runtimeExpr?: ts.Expression
    }
  | {
      type: "not"
      component: any
      joinIndex: number
      runtimeExpr?: ts.Expression
    }
  | {type: "entity"; joinIndex: number}
  | {
      type: "rel"
      joinIndex: number
      runtimeExpr?: ts.Expression
      subTerms?: QueryTerm[]
    }

type ParamQueryInfo = {
  paramName: ts.BindingName
  terms: QueryTerm[]
  isUnique: boolean
}

function getSymbolName(type: ts.Type): string | undefined {
  const symbol = type.aliasSymbol || type.getSymbol()
  return symbol?.getName()
}

function isGlomAllType(type: ts.Type): boolean {
  if (
    type.getProperty("__all") ||
    type.getProperty("__in") ||
    type.getProperty("__out") ||
    type.getProperty("__unique") ||
    type.getProperty("__join")
  )
    return true
  const name = getSymbolName(type)
  return (
    name === "All" ||
    name === "In" ||
    name === "Out" ||
    name === "Unique" ||
    name === "Join"
  )
}

function resolveTypeNode(
  node: ts.TypeNode,
  typeChecker: ts.TypeChecker,
): ts.TypeNode {
  if (ts.isTypeReferenceNode(node) && !node.typeArguments) {
    const type = typeChecker.getTypeAtLocation(node)
    const symbol = type.aliasSymbol || type.getSymbol()
    const name = symbol?.getName()
    if (
      name === "All" ||
      name === "In" ||
      name === "Out" ||
      name === "Unique" ||
      name === "Join" ||
      name === "Entity" ||
      name === "EntityTerm" ||
      name === "Read" ||
      name === "Write" ||
      name === "Has" ||
      name === "Not" ||
      name === "World" ||
      name === "Spawn" ||
      name === "Despawn" ||
      name === "Add" ||
      name === "Remove"
    ) {
      return node
    }
    const decl = symbol?.declarations?.[0]
    if (decl && ts.isTypeAliasDeclaration(decl)) {
      return resolveTypeNode(decl.type, typeChecker)
    }
  }
  return node
}

function extractAllTermsFromNode(
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

      if (name === "Read" || name === "Write") {
        const componentExpr = extractRuntimeExpr(
          factory,
          resolvedNode.typeArguments?.[0],
        )
        return {
          type: name === "Read" ? "read" : "write",
          storeIndex: storeIndex++,
          joinIndex: currentJoinIndex,
          runtimeExpr: componentExpr,
        }
      }

      if (name === "Has" || name === "Not") {
        const componentExpr = extractRuntimeExpr(
          factory,
          resolvedNode.typeArguments?.[0],
        )
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
  if (ts.isTypeReferenceNode(node)) {
    return entityNameToExpression(factory, node.typeName)
  }
  return undefined
}

function generateAllDescriptor(
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

function generateParamDescriptor(
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

function generatePreamble(
  queryParamName: string,
  terms: QueryTerm[],
  factory: ts.NodeFactory,
): ts.Statement[] {
  const statements: ts.Statement[] = []
  const allTerms = flattenTerms(terms)

  // const _e_to_i_query = query.entityToIndex
  statements.push(
    factory.createVariableStatement(
      undefined,
      factory.createVariableDeclarationList(
        [
          factory.createVariableDeclaration(
            `_e_to_i_${queryParamName}`,
            undefined,
            undefined,
            factory.createPropertyAccessExpression(
              factory.createIdentifier(queryParamName),
              factory.createIdentifier("entityToIndex"),
            ),
          ),
        ],
        ts.NodeFlags.Const,
      ),
    ),
  )

  const usedStores = new Set<number>()
  allTerms.forEach((t) => {
    if (t.storeIndex !== undefined) usedStores.add(t.storeIndex)
  })

  usedStores.forEach((idx) => {
    statements.push(
      factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList(
          [
            factory.createVariableDeclaration(
              `_store${idx}_${queryParamName}`,
              undefined,
              undefined,
              factory.createElementAccessExpression(
                factory.createPropertyAccessExpression(
                  factory.createIdentifier(queryParamName),
                  factory.createIdentifier("stores"),
                ),
                factory.createNumericLiteral(idx),
              ),
            ),
          ],
          ts.NodeFlags.Const,
        ),
      ),
    )
  })

  const joinCount =
    allTerms.reduce((max, t) => Math.max(max, t.joinIndex), 0) + 1
  for (let i = 0; i < joinCount; i++) {
    statements.push(
      factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList(
          [
            factory.createVariableDeclaration(
              `_q${i}_${queryParamName}`,
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

  return statements
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
          ...(currentJoinLevel === 0
            ? [
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
              ]
            : []),
          ...innerBody,
        ],
        true,
      ),
    )

    if (currentJoinLevel === 0) {
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
    } else {
      // Relational join or Cartesian product
      return [
        factory.createIfStatement(
          factory.createBinaryExpression(
            factory.createPropertyAccessExpression(
              qIdent,
              factory.createIdentifier("joinOnId"),
            ),
            ts.SyntaxKind.ExclamationEqualsEqualsToken,
            factory.createIdentifier("undefined"),
          ),
          factory.createBlock(
            [
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
                            factory.createIdentifier(
                              `_rel_map${currentJoinLevel}_${queryParamName}`,
                            ),
                            undefined,
                            undefined,
                            factory.createElementAccessExpression(
                              factory.createPropertyAccessExpression(
                                nIdent,
                                factory.createIdentifier("relMaps"),
                              ),
                              factory.createPropertyAccessExpression(
                                qIdent,
                                factory.createIdentifier("joinOnId"),
                              ),
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
                            factory.createIdentifier(
                              `_rel_targets${currentJoinLevel}_${queryParamName}`,
                            ),
                            undefined,
                            undefined,
                            factory.createConditionalExpression(
                              factory.createIdentifier(
                                `_rel_map${currentJoinLevel}_${queryParamName}`,
                              ),
                              factory.createToken(ts.SyntaxKind.QuestionToken),
                              factory.createCallExpression(
                                factory.createPropertyAccessExpression(
                                  factory.createPropertyAccessExpression(
                                    factory.createIdentifier(
                                      `_rel_map${currentJoinLevel}_${queryParamName}`,
                                    ),
                                    factory.createIdentifier(
                                      "subjectToObjects",
                                    ),
                                  ),
                                  factory.createIdentifier("get"),
                                ),
                                undefined,
                                [currentSubjectEnt!],
                              ),
                              factory.createToken(ts.SyntaxKind.ColonToken),
                              factory.createIdentifier("undefined"),
                            ),
                          ),
                        ],
                        ts.NodeFlags.Const,
                      ),
                    ),
                    factory.createIfStatement(
                      factory.createIdentifier(
                        `_rel_targets${currentJoinLevel}_${queryParamName}`,
                      ),
                      factory.createBlock(
                        [
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
                                factory.createPropertyAccessExpression(
                                  factory.createIdentifier(
                                    `_rel_targets${currentJoinLevel}_${queryParamName}`,
                                  ),
                                  factory.createIdentifier("dense"),
                                ),
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
                                          factory.createPropertyAccessExpression(
                                            factory.createIdentifier(
                                              `_rel_targets${currentJoinLevel}_${queryParamName}`,
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
                                ...innerBody,
                              ],
                              true,
                            ),
                          ),
                        ],
                        true,
                      ),
                    ),
                  ],
                  true,
                ),
              ),
            ],
            true,
          ),
          factory.createBlock(
            [
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
            ],
            true,
          ),
        ),
      ]
    }
  }

  return generateRecursive(0, undefined)
}

function flattenTerms(terms: QueryTerm[]): QueryTerm[] {
  const result: QueryTerm[] = []
  const visit = (t: QueryTerm) => {
    if (t.type === "rel" && t.subTerms) {
      result.push(t)
      t.subTerms.forEach(visit)
    } else {
      result.push(t)
    }
  }
  terms.forEach(visit)
  return result
}

function rewriteSystemFunction(
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

        return ts.visitEachChild(node, visitor, context)
      }

      return ts.visitNode(sourceFile, visitor) as ts.SourceFile
    }
  }
}

function processSystem(
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

function factoryWithMetadata(
  node: ts.Statement | ts.FunctionDeclaration,
  metadata: ts.ObjectLiteralExpression,
  name: string,
  factory: ts.NodeFactory,
): ts.Node {
  const defineProp = factory.createExpressionStatement(
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
            factory.createPropertyAssignment("value", metadata),
            factory.createPropertyAssignment(
              "enumerable",
              factory.createFalse(),
            ),
            factory.createPropertyAssignment(
              "configurable",
              factory.createTrue(),
            ),
          ],
          false,
        ),
      ],
    ),
  )

  if (ts.isFunctionDeclaration(node)) {
    return factory.createNodeArray([node, defineProp]) as any
  }

  return factory.createNodeArray([node, defineProp]) as any
}

function wrapWithMetadata(
  fnExpr: ts.Expression,
  metadata: ts.ObjectLiteralExpression,
  factory: ts.NodeFactory,
): ts.Expression {
  return factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createIdentifier("Object"),
      factory.createIdentifier("defineProperty"),
    ),
    undefined,
    [
      fnExpr,
      factory.createStringLiteral("__system_desc"),
      factory.createObjectLiteralExpression(
        [
          factory.createPropertyAssignment("value", metadata),
          factory.createPropertyAssignment("enumerable", factory.createFalse()),
          factory.createPropertyAssignment(
            "configurable",
            factory.createTrue(),
          ),
        ],
        false,
      ),
    ],
  )
}
