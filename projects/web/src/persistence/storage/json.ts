export type JSONPrimitive = string | number | boolean | null | undefined
export type AnyJSON = JSONPrimitive | JsonArray | JSONObject
export interface JSONObject {
    [key: string]: AnyJSON
}
export type JsonArray = Array<AnyJSON>
