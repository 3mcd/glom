import type ts from "typescript"

export type QueryTerm =
  | {
      type: "read"
      component?: any
      storeIndex: number
      joinIndex: number
      runtimeExpr?: ts.Expression
    }
  | {
      type: "write"
      component?: any
      storeIndex: number
      joinIndex: number
      runtimeExpr?: ts.Expression
    }
  | {
      type: "has"
      component?: any
      joinIndex: number
      runtimeExpr?: ts.Expression
    }
  | {
      type: "not"
      component?: any
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

export type ParamQueryInfo = {
  paramName: ts.BindingName
  terms: QueryTerm[]
  isUnique: boolean
}
