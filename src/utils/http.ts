export class HttpError extends Error {
  statusCode: number
  body: string
  headers?: Record<string, string>
  constructor(statusCode: number, body: string, headers?: Record<string, string>) {
    super(`HTTP ${statusCode}`)
    this.name = 'HttpError'
    this.statusCode = statusCode
    this.body = body
    this.headers = headers
  }
}

export function makeHttpError(statusCode: number, body: string, headers?: Record<string, string>) {
  return new HttpError(statusCode, body, headers)
}

export function isHttpError(e: any): e is HttpError {
  return !!e && (e instanceof HttpError || (typeof e.statusCode === 'number' && e.name === 'HttpError'))
}

