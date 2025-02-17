import { ZodSchema } from "zod";
import { Schema as YupSchema } from "yup";
import * as t from "io-ts";
import * as rt from "runtypes";
import Joi from "joi";

type ValidatorType = "zod" | "yup" | "io-ts" | "runtypes" | "joi";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

interface RetryConfig {
  attempts: number;
  backoff: "linear" | "exponential";
  initialDelay: number;
  maxDelay?: number;
  shouldRetry?: (error: Error) => boolean;
}

type RequestTransformer = (config: RequestInit) => Promise<RequestInit>;

type ResponseTransformer<T> = (response: Response, data: T) => Promise<T>;

interface FetchesConfig {
  baseUrl?: string;
  defaultHeaders?: HeadersInit;
  timeout?: number;
  validateResponse?: boolean;
  validatorType?: ValidatorType;
  cache?: {
    enabled: boolean;
    ttl: number;
    maxSize?: number;
  };
  retry?: RetryConfig;
  transformRequest?: RequestTransformer[];
  transformResponse?: ResponseTransformer<unknown>[];
}

class FetchesTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchesTimeoutError";
  }
}

class FetchesNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchesNetworkError";
  }
}

class FetchesValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchesValidationError";
  }
}

class FetchesResponseError<T> extends Error {
  public readonly response: Response;
  public readonly data?: T;

  constructor(response: Response, data?: T) {
    super(`HTTP Error: ${response.status} ${response.statusText}`);
    this.name = "FetchesResponseError";
    this.response = response;
    this.data = data;
  }
}

class RequestCache {
  private readonly cache: Map<string, CacheEntry<unknown>>;
  private readonly maxSize: number;
  private readonly keyOrder: string[];

  constructor(maxSize: number = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.keyOrder = [];
  }

  set(key: string, value: unknown, ttl: number): void {
    this.removeExpiredEntries();

    if (this.cache.has(key)) {
      const index = this.keyOrder.indexOf(key);
      if (index > -1) {
        this.keyOrder.splice(index, 1);
      }
    }

    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const oldestKey = this.keyOrder[0];
      if (oldestKey) {
        this.cache.delete(oldestKey);
        this.keyOrder.shift();
      }
    }

    this.cache.set(key, {
      data: value,
      timestamp: Date.now(),
      ttl,
    });
    this.keyOrder.push(key);
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T>;

    if (!entry) return null;

    if (this.isExpired(entry)) {
      this.delete(key);
      return null;
    }

    const index = this.keyOrder.indexOf(key);
    if (index > -1) {
      this.keyOrder.splice(index, 1);
      this.keyOrder.push(key);
    }

    return entry.data;
  }

  clear(): void {
    this.cache.clear();
    this.keyOrder.length = 0;
  }

  private isExpired(entry: CacheEntry<unknown>): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }

  private delete(key: string): void {
    this.cache.delete(key);
    const index = this.keyOrder.indexOf(key);
    if (index > -1) {
      this.keyOrder.splice(index, 1);
    }
  }

  private removeExpiredEntries(): void {
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.delete(key);
      }
    }
  }

  has(key: string): boolean {
    return this.cache.has(key) && !this.isExpired(this.cache.get(key)!);
  }

  size(): number {
    return this.cache.size;
  }

  keys(): string[] {
    return [...this.keyOrder];
  }
}

interface ValidatorAdapter<T, S> {
  validate(data: unknown, schema: S): T;
}

class ZodValidatorAdapter
  implements ValidatorAdapter<unknown, ZodSchema<unknown>>
{
  validate(data: unknown, schema: ZodSchema<unknown>): unknown {
    return schema.parse(data);
  }
}

class YupValidatorAdapter
  implements ValidatorAdapter<unknown, YupSchema<unknown>>
{
  validate(data: unknown, schema: YupSchema<unknown>): unknown {
    return schema.validateSync(data);
  }
}

class IoTsValidatorAdapter
  implements ValidatorAdapter<unknown, t.Type<unknown>>
{
  validate(data: unknown, schema: t.Type<unknown>): unknown {
    const result = schema.decode(data);
    if (result._tag === "Left") {
      throw new FetchesValidationError("io-ts validation failed");
    }
    return result.right;
  }
}

class RuntimesValidatorAdapter
  implements ValidatorAdapter<unknown, rt.Runtype<unknown>>
{
  validate(data: unknown, schema: rt.Runtype<unknown>): unknown {
    return schema.check(data);
  }
}

class JoiValidatorAdapter implements ValidatorAdapter<unknown, Joi.Schema> {
  validate(data: unknown, schema: Joi.Schema): unknown {
    const { error, value } = schema.validate(data);
    if (error) {
      throw new FetchesValidationError(error.message);
    }
    return value;
  }
}

class ValidatorFactory {
  static createValidator(
    type: ValidatorType
  ): ValidatorAdapter<unknown, unknown> {
    switch (type) {
      case "zod":
        return new ZodValidatorAdapter();
      case "yup":
        return new YupValidatorAdapter();
      case "io-ts":
        return new IoTsValidatorAdapter();
      case "runtypes":
        return new RuntimesValidatorAdapter();
      case "joi":
        return new JoiValidatorAdapter();
      default:
        throw new Error(`Unsupported validator type: ${type}`);
    }
  }
}

class Fetches {
  private readonly baseUrl?: string;
  private readonly defaultHeaders: HeadersInit;
  private readonly timeout: number;
  private readonly validateResponse: boolean;
  private readonly validatorType: ValidatorType;
  private readonly cache: RequestCache;
  private readonly retryConfig?: RetryConfig;
  private readonly validator: ValidatorAdapter<unknown, unknown>;
  private readonly requestTransformers: RequestTransformer[];
  private readonly responseTransformers: ResponseTransformer<unknown>[];
  private readonly activeRequests: Map<string, AbortController>;

  constructor(config: FetchesConfig = {}) {
    this.baseUrl = config.baseUrl;
    this.defaultHeaders = config.defaultHeaders || {};
    this.timeout = config.timeout ?? 30000;
    this.validateResponse = config.validateResponse ?? true;
    this.validatorType = config.validatorType ?? "zod";
    this.validator = ValidatorFactory.createValidator(this.validatorType);
    this.cache = new RequestCache(config.cache?.maxSize);
    this.retryConfig = config.retry;
    this.requestTransformers = config.transformRequest || [];
    this.responseTransformers = config.transformResponse || [];
    this.activeRequests = new Map();
  }

  public create<T = unknown, E = unknown>(schema?: unknown) {
    return {
      get: this.createMethod<T, E>("GET", schema),
      post: this.createMethod<T, E>("POST", schema),
      put: this.createMethod<T, E>("PUT", schema),
      patch: this.createMethod<T, E>("PATCH", schema),
      delete: this.createMethod<T, E>("DELETE", schema),
    };
  }

  public cancelRequest(requestId: string): void {
    const controller = this.activeRequests.get(requestId);
    if (controller) {
      controller.abort();
      this.activeRequests.delete(requestId);
    }
  }

  public cancelAllRequests(): void {
    this.activeRequests.forEach((controller) => controller.abort());
    this.activeRequests.clear();
  }

  private createMethod<T, E>(method: string, schema?: unknown) {
    return async (
      endpoint: string,
      data?: unknown,
      config: RequestInit & {
        requestId?: string;
        skipCache?: boolean;
        cacheTime?: number;
      } = {}
    ): Promise<T> => {
      const requestId = config.requestId ?? crypto.randomUUID();
      const cacheKey = this.getCacheKey(method, endpoint, data);

      if (method === "GET" && !config.skipCache) {
        const cachedData = this.cache.get<T>(cacheKey);
        if (cachedData) return cachedData;
      }

      const controller = new AbortController();
      this.activeRequests.set(requestId, controller);

      try {
        const response = await this.executeRequest<T, E>({
          method,
          endpoint,
          data,
          schema,
          controller,
          config,
        });

        if (method === "GET" && !config.skipCache) {
          this.cache.set(cacheKey, response, config.cacheTime ?? 300000);
        }

        return response;
      } finally {
        this.activeRequests.delete(requestId);
      }
    };
  }

  private async executeRequest<T, E>({
    method,
    endpoint,
    data,
    schema,
    controller,
    config,
  }: {
    method: string;
    endpoint: string;
    data?: unknown;
    schema?: unknown;
    controller: AbortController;
    config: RequestInit;
  }): Promise<T> {
    let attempt = 0;
    const maxAttempts = this.retryConfig?.attempts ?? 1;

    while (attempt < maxAttempts) {
      try {
        const mergedConfig = await this.applyRequestTransformers({
          ...config,
          method,
          body: data ? JSON.stringify(data) : undefined,
          signal: controller.signal,
          headers: {
            ...this.defaultHeaders,
            ...config.headers,
          },
        });

        const response = await this.performRequest(
          this.buildUrl(endpoint),
          mergedConfig
        );

        const processedResponse = await this.processResponse<T>(
          response,
          schema
        );

        return processedResponse;
      } catch (error) {
        if (!this.shouldRetry(error as Error, attempt, maxAttempts)) {
          throw this.normalizeError(error);
        }

        await this.delay(attempt);
        attempt++;
      }
    }

    throw new Error("Max retry attempts reached");
  }

  private async applyRequestTransformers(
    config: RequestInit
  ): Promise<RequestInit> {
    let transformedConfig = config;
    for (const transformer of this.requestTransformers) {
      transformedConfig = await transformer(transformedConfig);
    }
    return transformedConfig;
  }

  private async performRequest(
    url: string,
    config: RequestInit
  ): Promise<Response> {
    const timeoutId = setTimeout(() => {
      const signal = config.signal as AbortSignal;
      if (signal && !signal.aborted) {
        const controller = new AbortController();
        const abortError = new DOMException("Timeout", "TimeoutError");
        controller.abort(abortError);
        signal.dispatchEvent(new Event("abort"));
      }
    }, this.timeout);

    try {
      const response = await fetch(url, config);
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof DOMException && error.name === "AbortError") {
        if (error.message === "Timeout") {
          throw new FetchesTimeoutError(
            `Request timed out after ${this.timeout}ms`
          );
        }
      }
      throw error;
    }
  }

  private async processResponse<T>(
    response: Response,
    schema?: unknown
  ): Promise<T> {
    const contentType = response.headers.get("content-type");
    let data: unknown;

    if (contentType?.includes("application/json")) {
      data = await response.json();
    } else if (contentType?.includes("multipart/form-data")) {
      data = await response.formData();
    } else if (contentType?.includes("application/x-www-form-urlencoded")) {
      data = await response.formData();
    } else {
      data = await response.text();
    }

    for (const transformer of this.responseTransformers) {
      data = await transformer(response, data);
    }

    if (!response.ok) {
      throw new FetchesResponseError(response, data);
    }

    if (schema && this.validateResponse) {
      try {
        return this.validator.validate(data, schema) as T;
      } catch (error) {
        throw new FetchesValidationError(
          `Response validation failed: ${(error as Error).message}`
        );
      }
    }

    return data as T;
  }

  private shouldRetry(
    error: Error,
    attempt: number,
    maxAttempts: number
  ): boolean {
    if (attempt >= maxAttempts - 1) return false;
    if (!this.retryConfig?.shouldRetry) {
      return (
        error instanceof FetchesNetworkError ||
        error instanceof FetchesTimeoutError
      );
    }
    return this.retryConfig.shouldRetry(error);
  }

  private async delay(attempt: number): Promise<void> {
    const { backoff, initialDelay, maxDelay } = this.retryConfig!;
    let delay = initialDelay;

    if (backoff === "exponential") {
      delay = initialDelay * Math.pow(2, attempt);
    } else {
      delay = initialDelay * (attempt + 1);
    }

    if (maxDelay) {
      delay = Math.min(delay, maxDelay);
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  private buildUrl(endpoint: string): string {
    if (this.baseUrl) {
      return endpoint.startsWith("/")
        ? `${this.baseUrl}${endpoint}`
        : `${this.baseUrl}/${endpoint}`;
    }
    return endpoint;
  }

  private getCacheKey(
    method: string,
    endpoint: string,
    data?: unknown
  ): string {
    return `${method}:${endpoint}:${data ? JSON.stringify(data) : ""}`;
  }

  private normalizeError(error: unknown): Error {
    if (
      error instanceof FetchesTimeoutError ||
      error instanceof FetchesNetworkError ||
      error instanceof FetchesValidationError ||
      error instanceof FetchesResponseError
    ) {
      return error;
    }

    if (error instanceof Error) {
      return new FetchesNetworkError(error.message);
    }

    return new Error("Unknown error occurred");
  }
}

interface UploadOptions {
  onProgress?: (progress: number) => void;
  headers?: HeadersInit;
  timeout?: number;
}

export const uploadFile = async (
  url: string,
  file: File | Blob,
  options: UploadOptions = {}
): Promise<Response> => {
  const formData = new FormData();
  formData.append("file", file);

  const xhr = new XMLHttpRequest();

  return new Promise((resolve, reject) => {
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && options.onProgress) {
        const progress = (event.loaded / event.total) * 100;
        options.onProgress(progress);
      }
    });

    xhr.addEventListener("load", () => {
      resolve(
        new Response(xhr.response, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: new Headers(options.headers),
        })
      );
    });

    xhr.addEventListener("error", () => {
      reject(new FetchesNetworkError("Upload failed"));
    });

    xhr.addEventListener("timeout", () => {
      reject(new FetchesTimeoutError("Upload timed out"));
    });

    xhr.open("POST", url);
    xhr.timeout = options.timeout ?? 30000;

    if (options.headers) {
      Object.entries(options.headers).forEach(([key, value]) => {
        xhr.setRequestHeader(key, value as string);
      });
    }

    xhr.send(formData);
  });
};

export default Fetches;
