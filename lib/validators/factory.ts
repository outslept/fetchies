import type { ValidatorAdapter, ValidatorType } from '../types.js'
import { IoTsValidatorAdapter } from './io-ts.js'
import { JoiValidatorAdapter } from './joi.js'
import { RuntimesValidatorAdapter } from './runtypes.js'
import { YupValidatorAdapter } from './yup.js'
import { ZodValidatorAdapter } from './zod.js'

export class ValidatorFactory {
  static createValidator(type: ValidatorType): ValidatorAdapter<unknown, unknown> {
    switch (type) {
      case 'zod':
        return new ZodValidatorAdapter()
      case 'yup':
        return new YupValidatorAdapter()
      case 'io-ts':
        return new IoTsValidatorAdapter()
      case 'runtypes':
        return new RuntimesValidatorAdapter()
      case 'joi':
        return new JoiValidatorAdapter()
      default:
        throw new Error(`Unsupported validator type: ${type}`)
    }
  }
}
