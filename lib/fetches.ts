import type {
  FetchesConfig,
  FetchesResponse,
  RequestConfig,
  RequestInterceptor,
  RequestTransformer,
  ResponseInterceptor,
  ResponseTransformer,
  RetryConfig,
  ValidatorAdapter,
  ValidatorType,
} from './types.js'
import { RequestCache } from './cache.js'
import {
  FetchesNetworkError,
  FetchesResponseError,
  FetchesTimeoutError,
  FetchesValidationError,
} from './errors.js'
import { ValidatorFactory } from './validators/factory.js'

class Fetches {
  private readonly baseURL?: string
  private readonly defaultHeaders: HeadersInit
  private readonly timeout: number
  private readonly validateResponse: boolean
  private readonly validatorType: ValidatorType
  private readonly cache: RequestCache
  private readonly retryConfig?: RetryConfig
  private readonly validator: ValidatorAdapter<unknown, unknown>
  private readonly requestTransformers: RequestTransformer[]
  private readonly responseTransformers: ResponseTransformer<unknown>[]
  private readonly activeRequests: Map<string, AbortController>
  private requestInterceptors: RequestInterceptor[] = []
  private responseInterceptors: ResponseInterceptor[] = []

  constructor(config: FetchesConfig = {}) {
    this.baseURL = config.baseURL
    this.defaultHeaders = config.defaultHeaders || {}
    this.timeout = config.timeout ?? 30000
    this.validateResponse = config.validateResponse ?? true
    this.validatorType = config.validatorType ?? 'zod'
    this.validator = ValidatorFactory.createValidator(this.validatorType)
    this.cache = new RequestCache(config.cache?.maxSize)
    this.retryConfig = config.retry
    this.requestTransformers = config.transformRequest || []
    this.responseTransformers = config.transformResponse || []
    this.activeRequests = new Map()

    if (config.interceptors?.request) {
      this.requestInterceptors = [...config.interceptors.request]
    }
    if (config.interceptors?.response) {
      this.responseInterceptors = [...config.interceptors.response]
    }
  }

  public interceptors = {
    request: {
      use: (
        onFulfilled?: RequestInterceptor['onFulfilled'],
        onRejected?: RequestInterceptor['onRejected'],
      ): number => {
        const id = this.requestInterceptors.length
        this.requestInterceptors.push({ onFulfilled, onRejected })
        return id
      },
      eject: (id: number): void => {
        if (id >= 0 && id < this.requestInterceptors.length) {
          this.requestInterceptors[id] = {} as RequestInterceptor
        }
      },
    },
    response: {
      use: (
        onFulfilled?: ResponseInterceptor['onFulfilled'],
        onRejected?: ResponseInterceptor['onRejected'],
      ): number => {
        const id = this.responseInterceptors.length
        this.responseInterceptors.push({ onFulfilled, onRejected })
        return id
      },
      eject: (id: number): void => {
        if (id >= 0 && id < this.responseInterceptors.length) {
          this.responseInterceptors[id] = {} as ResponseInterceptor
        }
      },
    },
  }

  public get<T = any>(url: string, config?: RequestConfig): Promise<FetchesResponse<T>> {
    return this.request<T>({ ...config, method: 'GET', url })
  }

  public post<T = any>(url: string, data?: any, config?: RequestConfig): Promise<FetchesResponse<T>> {
    return this.request<T>({ ...config, method: 'POST', url, data })
  }

  public put<T = any>(url: string, data?: any, config?: RequestConfig): Promise<FetchesResponse<T>> {
    return this.request<T>({ ...config, method: 'PUT', url, data })
  }

  public patch<T = any>(url: string, data?: any, config?: RequestConfig): Promise<FetchesResponse<T>> {
    return this.request<T>({ ...config, method: 'PATCH', url, data })
  }

  public delete<T = any>(url: string, config?: RequestConfig): Promise<FetchesResponse<T>> {
    return this.request<T>({ ...config, method: 'DELETE', url })
  }

  public create<T = unknown>(schema?: unknown) {
    return {
      get: (url: string, config?: RequestConfig): Promise<FetchesResponse<T>> =>
        this.request<T>({ ...config, method: 'GET', url, validatorSchema: schema }),
      post: (url: string, data?: any, config?: RequestConfig): Promise<FetchesResponse<T>> =>
        this.request<T>({ ...config, method: 'POST', url, data, validatorSchema: schema }),
      put: (url: string, data?: any, config?: RequestConfig): Promise<FetchesResponse<T>> =>
        this.request<T>({ ...config, method: 'PUT', url, data, validatorSchema: schema }),
      patch: (url: string, data?: any, config?: RequestConfig): Promise<FetchesResponse<T>> =>
        this.request<T>({ ...config, method: 'PATCH', url, data, validatorSchema: schema }),
      delete: (url: string, config?: RequestConfig): Promise<FetchesResponse<T>> =>
        this.request<T>({ ...config, method: 'DELETE', url, validatorSchema: schema }),
    }
  }

  public cancelRequest(requestId: string): void {
    const controller = this.activeRequests.get(requestId)
    if (controller) {
      controller.abort()
      this.activeRequests.delete(requestId)
    }
  }

  public cancelAllRequests(): void {
    this.activeRequests.forEach(controller => controller.abort())
    this.activeRequests.clear()
  }

  public async request<T = any>(config: RequestConfig): Promise<FetchesResponse<T>> {
    const mergedConfig: RequestConfig = {
      ...config,
      baseURL: config.baseURL ?? this.baseURL,
      timeout: config.timeout ?? this.timeout,
      validateResponse: config.validateResponse ?? this.validateResponse,
      validatorType: config.validatorType ?? this.validatorType,
      headers: {
        ...this.defaultHeaders,
        ...config.headers,
      },
    }

    const finalConfig = await this.applyRequestInterceptors(mergedConfig)

    const requestId = finalConfig.requestId ?? crypto.randomUUID()
    const method = (finalConfig.method ?? 'GET').toUpperCase()
    const url = this.buildUrl(finalConfig.url ?? '', finalConfig.baseURL, finalConfig.params)
    const cacheKey = this.getCacheKey(method, url, finalConfig.data)

    if (method === 'GET' && !finalConfig.skipCache) {
      const cachedData = this.cache.get<FetchesResponse<T>>(cacheKey)
      if (cachedData)
        return cachedData
    }

    const controller = new AbortController()
    this.activeRequests.set(requestId, controller)

    try {
      const response = await this.executeRequest<T>({
        config: finalConfig,
        controller,
        url,
      })

      if (method === 'GET' && !finalConfig.skipCache) {
        this.cache.set(cacheKey, response, finalConfig.cacheTime ?? 300000)
      }
      else if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        const urlWithoutParams = url.split('?')[0]
        this.cache.invalidate(new RegExp(`^(GET|HEAD):${urlWithoutParams}`))
      }

      return response
    }
    finally {
      this.activeRequests.delete(requestId)
    }
  }

  private async executeRequest<T>({
    config,
  controller,
  url,
  }: {
    config: RequestConfig
    controller: AbortController
    url: string
  }): Promise<FetchesResponse<T>> {
    const method = (config.method ?? 'GET').toUpperCase()
    let attempt = 0
    const maxAttempts = this.retryConfig?.attempts ?? 1

    while (attempt < maxAttempts) {
      try {
        const transformedConfig = await this.applyRequestTransformers(config)

        const body = this.prepareRequestBody(transformedConfig.data)
        const contentType = this.getContentType(transformedConfig.data)
        const headers = new Headers(transformedConfig.headers || {})

        if (contentType && !headers.has('Content-Type')) {
          headers.set('Content-Type', contentType)
        }

        const fetchConfig: RequestInit = {
          method,
          headers,
          body,
          signal: controller.signal,
          credentials: transformedConfig.credentials,
          cache: transformedConfig.cache,
          redirect: transformedConfig.redirect,
          referrer: transformedConfig.referrer,
          referrerPolicy: transformedConfig.referrerPolicy,
          integrity: transformedConfig.integrity,
          keepalive: transformedConfig.keepalive,
          mode: transformedConfig.mode,
        }

        const response = await this.performRequest(url, fetchConfig, transformedConfig.timeout ?? this.timeout)

        const processedResponse = await this.processResponse<T>(
          response,
          transformedConfig,
          url,
        )

        return this.applyResponseInterceptors(processedResponse)
      }
      catch (error) {
        if (!this.shouldRetry(error as Error, attempt, maxAttempts)) {
          throw this.normalizeError(error)
        }

        await this.delay(attempt)
        attempt++
      }
    }

    throw new Error('Max retry attempts reached')
  }

  private async applyRequestInterceptors(config: RequestConfig): Promise<RequestConfig> {
    let resultConfig = { ...config }

    for (const interceptor of this.requestInterceptors) {
      if (interceptor.onFulfilled) {
        try {
          resultConfig = await interceptor.onFulfilled(resultConfig)
        }
        catch (error) {
          if (interceptor.onRejected) {
            await interceptor.onRejected(error as Error)
          }
          throw error
        }
      }
    }

    return resultConfig
  }

  private async applyResponseInterceptors<T>(response: FetchesResponse<T>): Promise<FetchesResponse<T>> {
    let resultResponse = response

    for (const interceptor of this.responseInterceptors) {
      if (interceptor.onFulfilled) {
        try {
          resultResponse = await interceptor.onFulfilled(resultResponse) as FetchesResponse<T>
        }
        catch (error) {
          if (interceptor.onRejected) {
            await interceptor.onRejected(error as Error)
          }
          throw error
        }
      }
    }

    return resultResponse
  }

  private async applyRequestTransformers(
    config: RequestConfig,
  ): Promise<RequestConfig> {
    let transformedConfig = { ...config }
    for (const transformer of this.requestTransformers) {
      transformedConfig = await transformer(transformedConfig)
    }
    return transformedConfig
  }

  private prepareRequestBody(data: any): BodyInit | null | undefined {
    if (data === undefined || data === null) {
      return null
    }

    if (data instanceof FormData
      || data instanceof URLSearchParams
      || data instanceof Blob
      || data instanceof ArrayBuffer
      || typeof data === 'string') {
      return data
    }

    if (typeof data === 'object') {
      return JSON.stringify(data)
    }

    return String(data)
  }

  private getContentType(data: any): string | undefined {
    if (data === undefined || data === null) {
      return undefined
    }

    if (data instanceof FormData) {
      return undefined
    }

    if (data instanceof URLSearchParams) {
      return 'application/x-www-form-urlencoded'
    }

    if (data instanceof Blob) {
      return data.type || 'application/octet-stream'
    }

    if (data instanceof ArrayBuffer) {
      return 'application/octet-stream'
    }

    if (typeof data === 'object') {
      return 'application/json'
    }

    return 'text/plain'
  }

  private async performRequest(
    url: string,
    config: RequestInit,
    timeout: number,
  ): Promise<Response> {
    const timeoutId = setTimeout(() => {
      const signal = config.signal as AbortSignal
      if (signal && !signal.aborted) {
        const controller = new AbortController()
        const abortError = new DOMException('Timeout', 'TimeoutError')
        controller.abort(abortError)
        signal.dispatchEvent(new Event('abort'))
      }
    }, timeout)

    try {
      const response = await fetch(url, config)
      clearTimeout(timeoutId)
      return response
    }
    catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (error.message === 'Timeout') {
          throw new FetchesTimeoutError(
            `Request timed out after ${timeout}ms`,
          )
        }
      }
      throw error
    }
  }

  private async processResponse<T>(
    response: Response,
    config: RequestConfig,
  ): Promise<FetchesResponse<T>> {
    const contentType = response.headers.get('content-type')
    let data: any

    if (contentType?.includes('application/json')) {
      data = await response.json()
    }
    else if (contentType?.includes('multipart/form-data')) {
      data = await response.formData()
    }
    else if (contentType?.includes('application/x-www-form-urlencoded')) {
      data = await response.formData()
    }
    else {
      data = await response.text()
    }

    for (const transformer of this.responseTransformers) {
      data = await transformer(response, data)
    }

    const fetchesResponse: FetchesResponse<T> = {
      data,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      config,
    }

    if (!response.ok) {
      throw new FetchesResponseError(response, data)
    }

    if (config.validatorSchema && (config.validateResponse ?? this.validateResponse)) {
      try {
        const validatorType = config.validatorType ?? this.validatorType
        const validator = ValidatorFactory.createValidator(validatorType)
        fetchesResponse.data = validator.validate(data, config.validatorSchema) as T
      }
      catch (error) {
        throw new FetchesValidationError(
          `Response validation failed: ${(error as Error).message}`,
        )
      }
    }

    return fetchesResponse
  }

  private shouldRetry(
    error: Error,
    attempt: number,
    maxAttempts: number,
  ): boolean {
    if (attempt >= maxAttempts - 1)
      return false
    if (!this.retryConfig?.shouldRetry) {
      return (
        error instanceof FetchesNetworkError
        || error instanceof FetchesTimeoutError
      )
    }
    return this.retryConfig.shouldRetry(error)
  }

  private async delay(attempt: number): Promise<void> {
    const { backoff, initialDelay, maxDelay } = this.retryConfig!
    let delay = initialDelay

    if (backoff === 'exponential') {
      delay = initialDelay * 2 ** attempt
    }
    else {
      delay = initialDelay * (attempt + 1)
    }

    if (maxDelay) {
      delay = Math.min(delay, maxDelay)
    }

    await new Promise(resolve => setTimeout(resolve, delay))
  }

  private buildUrl(
    endpoint: string,
    baseURL?: string,
    params?: Record<string, any>,
  ): string {
    let url = ''
    const base = baseURL ?? this.baseURL ?? ''

    if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
      url = endpoint
    }
    else {
      url = endpoint.startsWith('/')
        ? `${base}${endpoint}`
        : `${base}/${endpoint}`
    }

    if (params && Object.keys(params).length > 0) {
      const searchParams = new URLSearchParams()

      Object.entries(params).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          value.forEach((v) => {
            if (v !== undefined && v !== null) {
              searchParams.append(key, String(v))
            }
          })
        }
        else if (value !== undefined && value !== null) {
          searchParams.append(key, String(value))
        }
      })

      const queryString = searchParams.toString()
      if (queryString) {
        url += (url.includes('?') ? '&' : '?') + queryString
      }
    }

    return url
  }

  private getCacheKey(
    method: string,
    url: string,
    data?: any,
  ): string {
    return `${method}:${url}:${data ? JSON.stringify(data) : ''}`
  }

  private normalizeError(error: unknown): Error {
    if (
      error instanceof FetchesTimeoutError
      || error instanceof FetchesNetworkError
      || error instanceof FetchesValidationError
      || error instanceof FetchesResponseError
    ) {
      return error
    }

    if (error instanceof Error) {
      return new FetchesNetworkError(error.message)
    }

    return new Error('Unknown error occurred')
  }
}

export default Fetches
