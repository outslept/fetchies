# Fetches

Fetches is a TypeScript HTTP client that provides a type-safe approach to handling API requests. It combines features like request caching, response validation, retry mechanisms, and file upload capabilities into a single package.

## Features

### Type Safety

Built with TypeScript, Fetches provides complete type safety for your API requests and responses. It supports multiple validation libraries including Zod, Yup, io-ts, Runtypes, and Joi.

### Advanced Caching

The built-in caching system manages your API responses with features like:

- Customizable TTL (Time To Live)
- LRU (Least Recently Used) cache implementation
- Automatic cache invalidation
- Cache size limits

### Retry Mechanism

Handle temporary network issues with configurable retry logic:

- Linear or exponential backoff strategies
- Custom retry conditions
- Configurable attempt limits and delays

### Request/Response Transformation

Transform your requests and responses with custom middleware:

- Modify requests before they're sent
- Transform responses before they're returned
- Add custom headers or authentication
- Log or monitor request/response cycles

### File Upload Support

Handle file uploads with progress tracking:

- Progress monitoring
- Timeout handling
- Custom headers support
- Multiple file upload capability
