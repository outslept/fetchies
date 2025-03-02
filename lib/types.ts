export type ValidatorType = 'zod' | 'yup' | 'io-ts' | 'runtypes' | 'joi'

export interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
}

export interface RetryConfig {
  attempts: number
  backoff: 'linear' | 'exponential'
  initialDelay: number
  maxDelay?: number
  shouldRetry?: (error: Error) => boolean
}

export type RequestTransformer = (config: RequestConfig) => Promise<RequestConfig> | RequestConfig

export type ResponseTransformer<T> = (response: Response, data: T) => Promise<T> | T

export interface RequestInterceptor {
  onFulfilled?: (config: RequestConfig) => Promise<RequestConfig> | RequestConfig
  onRejected?: (error: Error) => Promise<Error> | Error
}

export interface ResponseInterceptor<T = any> {
  onFulfilled?: (response: T) => Promise<T> | T
  onRejected?: (error: Error) => Promise<Error> | Error
}

export interface RequestConfig extends Omit<RequestInit, 'body'> {
  url?: string
  method?: string
  baseURL?: string
  data?: any
  params?: Record<string, any>
  timeout?: number
  validateResponse?: boolean
  validatorSchema?: unknown
  validatorType?: ValidatorType
  requestId?: string
  skipCache?: boolean
  cacheTime?: number
  onUploadProgress?: (progressEvent: ProgressEvent) => void
  onDownloadProgress?: (progressEvent: ProgressEvent) => void
}

export interface FetchesConfig {
  baseURL?: string
  defaultHeaders?: HeadersInit
  timeout?: number
  validateResponse?: boolean
  validatorType?: ValidatorType
  cache?: {
    enabled: boolean
    ttl: number
    maxSize?: number
  }
  retry?: RetryConfig
  transformRequest?: RequestTransformer[]
  transformResponse?: ResponseTransformer<unknown>[]
  interceptors?: {
    request?: RequestInterceptor[]
    response?: ResponseInterceptor[]
  }
}

export interface UploadOptions {
  onProgress?: (progress: number) => void
  headers?: HeadersInit
  timeout?: number
  fields?: Record<string, any>
  xhr?: XMLHttpRequest
}

export interface ValidatorAdapter<T, S> {
  validate: (data: unknown, schema: S) => T
}

export interface FetchesResponse<T = any> {
  data: T
  status: number
  statusText: string
  headers: Headers
  config: RequestConfig
  request?: Request
}
