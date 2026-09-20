export function decimalsMapOf(assets: ReadonlyArray<{ code: string; decimals: number }>): Map<string, number> {
  return new Map(assets.map((a) => [a.code, a.decimals]));
}
