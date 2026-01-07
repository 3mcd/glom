import ts from "typescript"

export function factoryWithMetadata(
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

export function wrapWithMetadata(
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
