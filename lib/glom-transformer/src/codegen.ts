import ts from "typescript"
import type {QueryTerm} from "./types"

export function flattenTerms(terms: QueryTerm[]): QueryTerm[] {
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

export function generatePreamble(
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

export function generateLoops(
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
