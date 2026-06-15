export function modelNumberFromBase(base = import.meta.env.BASE_URL) {
  return base.match(/modell(\d+)/i)?.[1] ?? '3'
}

export function modelTitle() {
  return `Finanzmodell Hektopascal — Modell ${modelNumberFromBase()}`
}
