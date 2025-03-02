import type * as t from 'io-ts'
import type { ValidatorAdapter } from '../types.js'
import { FetchesValidationError } from '../errors.js'

export class IoTsValidatorAdapter implements ValidatorAdapter<unknown, t.Type<unknown>> {
  validate(data: unknown, schema: t.Type<unknown>): unknown {
    const result = schema.decode(data)
    if (result._tag === 'Left') {
      throw new FetchesValidationError('io-ts validation failed')
    }
    return result.right
  }
}
