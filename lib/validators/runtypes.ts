import type * as rt from 'runtypes'
import type { ValidatorAdapter } from '../types.js'
import { FetchesValidationError } from '../errors.js'

export class RuntimesValidatorAdapter implements ValidatorAdapter<unknown, rt.Runtype<unknown>> {
  validate(data: unknown, schema: rt.Runtype<unknown>): unknown {
    try {
      return schema.check(data)
    }
    catch (error) {
      throw new FetchesValidationError(`Runtypes validation failed: ${(error as Error).message}`)
    }
  }
}
