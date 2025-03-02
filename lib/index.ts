import type {
  FetchesConfig,
  FetchesResponse,
  RequestConfig,
  RequestInterceptor,
  RequestTransformer,
  ResponseInterceptor,
  ResponseTransformer,
  RetryConfig,
  UploadOptions,
  ValidatorType,
} from './types.js'
import {
  FetchesNetworkError,
  FetchesResponseError,
  FetchesTimeoutError,
  FetchesValidationError,
} from './errors.js'
import Fetches from './fetches.js'
import { createUploader, uploadFile } from './upload.js'

function createFetches(config?: FetchesConfig): Fetches {
  return new Fetches(config)
}

const defaultInstance = new Fetches()

export {
  createFetches,
  createUploader,
  Fetches,
  defaultInstance as fetches,
  FetchesNetworkError,
  FetchesResponseError,
  FetchesTimeoutError,
  FetchesValidationError,
  uploadFile,
}

export type {
  FetchesConfig,
  FetchesResponse,
  RequestConfig,
  RequestInterceptor,
  RequestTransformer,
  ResponseInterceptor,
  ResponseTransformer,
  RetryConfig,
  UploadOptions,
  ValidatorType,
}

export default defaultInstance
