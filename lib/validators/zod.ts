import type { ZodSchema } from 'zod'
import type { ValidatorAdapter } from '../types.js'
import { FetchesValidationError } from '../errors.js'

export class ZodValidatorAdapter implements ValidatorAdapter<unknown, ZodSchema<unknown>> {
  validate(data: unknown, schema: ZodSchema<unknown>): unknown {
    try {
      return schema.parse(data)
    }
    catch (error) {
      throw new FetchesValidationError(`Zod validation failed: ${(error as Error).message}`)
    }
  }
}
