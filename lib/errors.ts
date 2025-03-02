export class FetchesTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FetchesTimeoutError'
  }
}

export class FetchesNetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FetchesNetworkError'
  }
}

export class FetchesValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FetchesValidationError'
  }
}

export class FetchesResponseError<T> extends Error {
  public readonly response: Response
  public readonly data?: T

  constructor(response: Response, data?: T) {
    super(`HTTP Error: ${response.status} ${response.statusText}`)
    this.name = 'FetchesResponseError'
    this.response = response
    this.data = data
  }
}
