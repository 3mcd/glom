import ts from "typescript"

/**
 * Information about a single serializable field (or the root value for
 * primitive component types like bare `number`).
 */
type FieldInfo = {
  name: string
  /** Bytes consumed by this field. */
  size: number
  /** e.g. "writeFloat64" */
  writeMethod: string
  /** e.g. "readFloat64" */
  readMethod: string
  /** Whether the field needs a boolean coercion (val ? 1 : 0 / !== 0). */
  isBoolean: boolean
}

/**
 * Try to derive serde information from a TypeScript type.
 * Returns `undefined` when the type is not auto-serialisable.
 */
function analyzeType(
  type: ts.Type,
  typeChecker: ts.TypeChecker,
): FieldInfo[] | undefined {
  // --- bare `number` ---
  if (
    type.flags & ts.TypeFlags.Number ||
    type.flags & ts.TypeFlags.NumberLike
  ) {
    return [
      {
        name: "",
        size: 8,
        writeMethod: "writeFloat64",
        readMethod: "readFloat64",
        isBoolean: false,
      },
    ]
  }

  // --- bare `boolean` ---
  if (
    type.flags & ts.TypeFlags.Boolean ||
    type.flags & ts.TypeFlags.BooleanLike
  ) {
    return [
      {
        name: "",
        size: 1,
        writeMethod: "writeUint8",
        readMethod: "readUint8",
        isBoolean: true,
      },
    ]
  }

  // --- object literal / interface with only number | boolean props ---
  if (type.flags & ts.TypeFlags.Object) {
    const properties = type.getProperties()
    if (properties.length === 0) return undefined

    const fields: FieldInfo[] = []
    for (const prop of properties) {
      const propType = typeChecker.getTypeOfSymbol(prop)
      if (
        propType.flags & ts.TypeFlags.Number ||
        propType.flags & ts.TypeFlags.NumberLike
      ) {
        fields.push({
          name: prop.getName(),
          size: 8,
          writeMethod: "writeFloat64",
          readMethod: "readFloat64",
          isBoolean: false,
        })
      } else if (
        propType.flags & ts.TypeFlags.Boolean ||
        propType.flags & ts.TypeFlags.BooleanLike
      ) {
        fields.push({
          name: prop.getName(),
          size: 1,
          writeMethod: "writeUint8",
          readMethod: "readUint8",
          isBoolean: true,
        })
      } else {
        // Unsupported property type – bail out entirely.
        return undefined
      }
    }
    return fields
  }

  return undefined
}

/**
 * Build the AST for a serde object literal: `{ bytesPerElement, encode, decode }`.
 */
function buildSerdeExpression(
  fields: FieldInfo[],
  factory: ts.NodeFactory,
): ts.ObjectLiteralExpression {
  const bytesPerElement = fields.reduce((sum, f) => sum + f.size, 0)
  const isBare = fields.length === 1 && fields[0]!.name === ""

  // --- bytesPerElement ---
  const bytesPerElementProp = factory.createPropertyAssignment(
    "bytesPerElement",
    factory.createNumericLiteral(bytesPerElement),
  )

  // --- encode ---
  const valParam = factory.createParameterDeclaration(
    undefined,
    undefined,
    "val",
  )
  const writerParam = factory.createParameterDeclaration(
    undefined,
    undefined,
    "writer",
  )

  let encodeBody: ts.ConciseBody
  if (isBare) {
    const field = fields[0]!
    let arg: ts.Expression = factory.createIdentifier("val")
    if (field.isBoolean) {
      // val ? 1 : 0
      arg = factory.createConditionalExpression(
        factory.createIdentifier("val"),
        undefined,
        factory.createNumericLiteral(1),
        undefined,
        factory.createNumericLiteral(0),
      )
    }
    encodeBody = factory.createBlock(
      [
        factory.createExpressionStatement(
          factory.createCallExpression(
            factory.createPropertyAccessExpression(
              factory.createIdentifier("writer"),
              field.writeMethod,
            ),
            undefined,
            [arg],
          ),
        ),
      ],
      true,
    )
  } else {
    const statements = fields.map((field) => {
      let arg: ts.Expression = factory.createPropertyAccessExpression(
        factory.createIdentifier("val"),
        field.name,
      )
      if (field.isBoolean) {
        arg = factory.createConditionalExpression(
          arg,
          undefined,
          factory.createNumericLiteral(1),
          undefined,
          factory.createNumericLiteral(0),
        )
      }
      return factory.createExpressionStatement(
        factory.createCallExpression(
          factory.createPropertyAccessExpression(
            factory.createIdentifier("writer"),
            field.writeMethod,
          ),
          undefined,
          [arg],
        ),
      )
    })
    encodeBody = factory.createBlock(statements, true)
  }

  const encodeFn = factory.createArrowFunction(
    undefined,
    undefined,
    [valParam, writerParam],
    undefined,
    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    encodeBody,
  )
  const encodeProp = factory.createPropertyAssignment("encode", encodeFn)

  // --- decode ---
  const readerParam = factory.createParameterDeclaration(
    undefined,
    undefined,
    "reader",
  )

  const valueParam = factory.createParameterDeclaration(
    undefined,
    undefined,
    "value",
  )

  let decodeBody: ts.ConciseBody
  let decodeParams: ts.ParameterDeclaration[]
  if (isBare) {
    const field = fields[0]!
    let readExpr: ts.Expression = factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("reader"),
        field.readMethod,
      ),
      undefined,
      [],
    )
    if (field.isBoolean) {
      // reader.readUint8() !== 0
      readExpr = factory.createBinaryExpression(
        readExpr,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        factory.createNumericLiteral(0),
      )
    }
    decodeBody = factory.createBlock(
      [factory.createReturnStatement(readExpr)],
      true,
    )
    decodeParams = [readerParam]
  } else {
    // const v = value !== undefined ? value : {};
    const vDecl = factory.createVariableStatement(
      undefined,
      factory.createVariableDeclarationList(
        [
          factory.createVariableDeclaration(
            "v",
            undefined,
            undefined,
            factory.createConditionalExpression(
              factory.createBinaryExpression(
                factory.createIdentifier("value"),
                ts.SyntaxKind.ExclamationEqualsEqualsToken,
                factory.createIdentifier("undefined"),
              ),
              undefined,
              factory.createIdentifier("value"),
              undefined,
              factory.createObjectLiteralExpression([]),
            ),
          ),
        ],
        ts.NodeFlags.Const,
      ),
    )

    // v.field = reader.readXxx();  (one per field)
    const assignments = fields.map((field) => {
      let readExpr: ts.Expression = factory.createCallExpression(
        factory.createPropertyAccessExpression(
          factory.createIdentifier("reader"),
          field.readMethod,
        ),
        undefined,
        [],
      )
      if (field.isBoolean) {
        readExpr = factory.createBinaryExpression(
          readExpr,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
          factory.createNumericLiteral(0),
        )
      }
      return factory.createExpressionStatement(
        factory.createBinaryExpression(
          factory.createPropertyAccessExpression(
            factory.createIdentifier("v"),
            field.name,
          ),
          ts.SyntaxKind.EqualsToken,
          readExpr,
        ),
      )
    })

    decodeBody = factory.createBlock(
      [
        vDecl,
        ...assignments,
        factory.createReturnStatement(factory.createIdentifier("v")),
      ],
      true,
    )
    decodeParams = [readerParam, valueParam]
  }

  const decodeFn = factory.createArrowFunction(
    undefined,
    undefined,
    decodeParams,
    undefined,
    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    decodeBody,
  )
  const decodeProp = factory.createPropertyAssignment("decode", decodeFn)

  return factory.createObjectLiteralExpression(
    [bytesPerElementProp, encodeProp, decodeProp],
    true,
  )
}

/**
 * Check whether a call expression is a `defineComponent(...)` call and, if so,
 * whether it already has a serde argument.  If the call has no serde and the
 * type parameter is auto-serialisable, return a new call expression with the
 * serde injected.  Otherwise return `undefined` (leave the node untouched).
 */
export function processDefineComponent(
  node: ts.CallExpression,
  typeChecker: ts.TypeChecker,
  factory: ts.NodeFactory,
): ts.CallExpression | undefined {
  // --- Is this a defineComponent call? ---
  let calleeName: string | undefined
  if (ts.isIdentifier(node.expression)) {
    calleeName = node.expression.text
  } else if (ts.isPropertyAccessExpression(node.expression)) {
    calleeName = node.expression.name.text
  }

  if (calleeName !== "defineComponent") return undefined

  // --- Already has serde (2nd arg)? Skip. ---
  if (node.arguments.length !== 1) return undefined

  // --- Resolve the type parameter T ---
  // Try explicit type arguments first: defineComponent<T>(...)
  let componentType: ts.Type | undefined
  if (node.typeArguments && node.typeArguments.length > 0) {
    componentType = typeChecker.getTypeFromTypeNode(node.typeArguments[0]!)
  }

  if (!componentType) return undefined

  // --- Analyze the type ---
  const fields = analyzeType(componentType, typeChecker)
  if (!fields || fields.length === 0) return undefined

  // --- Build the serde literal and inject as second argument ---
  const serdeExpr = buildSerdeExpression(fields, factory)

  return factory.updateCallExpression(
    node,
    node.expression,
    node.typeArguments,
    [...node.arguments, serdeExpr],
  )
}
