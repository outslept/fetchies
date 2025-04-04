import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    'src/index',
  ],
  clean: true,
  declaration: true,
  rollup: {
    emitCJS: true,
  },
  externals: [
    'zod',
    'yup',
    'io-ts',
    'runtypes',
    'joi',
  ],
})
