import type { Schema as YupSchema } from 'yup'
import type { ValidatorAdapter } from '../types.js'
import { FetchesValidationError } from '../errors.js'

export class YupValidatorAdapter implements ValidatorAdapter<unknown, YupSchema<unknown>> {
  validate(data: unknown, schema: YupSchema<unknown>): unknown {
    try {
      return schema.validateSync(data)
    }
    catch (error) {
      throw new FetchesValidationError(`Yup validation failed: ${(error as Error).message}`)
    }
  }
}
