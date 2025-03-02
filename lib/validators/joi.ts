import type Joi from 'joi'
import type { ValidatorAdapter } from '../types.js'
import { FetchesValidationError } from '../errors.js'

export class JoiValidatorAdapter implements ValidatorAdapter<unknown, Joi.Schema> {
  validate(data: unknown, schema: Joi.Schema): unknown {
    const { error, value } = schema.validate(data)
    if (error) {
      throw new FetchesValidationError(error.message)
    }
    return value
  }
}
