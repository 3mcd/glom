import ts from "typescript"

export function getSymbolName(type: ts.Type): string | undefined {
  const symbol = type.aliasSymbol || type.getSymbol()
  return symbol?.getName()
}

export function isGlomAllType(type: ts.Type): boolean {
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

export function resolveTypeNode(
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
