/* eslint-disable no-console */
import { z } from 'zod'
import { createFetches } from '../lib/index.js'

const ExamplePageSchema = z.object({
  title: z.string(),
  description: z.string(),
  linkText: z.string(),
  linkUrl: z.string(),
})

type ExamplePage = z.infer<typeof ExamplePageSchema>

const api = createFetches({
  baseURL: 'https://example.com',
  timeout: 5000,
  cache: {
    enabled: true,
    ttl: 60000,
    maxSize: 10,
  },
  retry: {
    attempts: 3,
    backoff: 'exponential',
    initialDelay: 300,
  },
})

api.interceptors.request.use((config) => {
  console.log(`🚀 Request: ${config.method} ${config.url}`)
  return config
})

api.interceptors.response.use((response) => {
  console.log(`✅ Response: ${response.status} from ${response.config.url}`)
  return response
})

function parseExamplePage(): ExamplePage {
  return {
    title: 'Example Domain',
    description: 'This domain is for use in illustrative examples in documents. You may use this domain in literature without prior coordination or asking for permission.',
    linkText: 'More information...',
    linkUrl: 'https://www.iana.org/domains/example',
  }
}

async function fetchExamplePage(): Promise<ExamplePage> {
  try {
    const parsedData = parseExamplePage()

    return ExamplePageSchema.parse(parsedData)
  }
  catch (error) {
    // @ts-expect-error -- im fine with ignoring this in a demo
    console.error('Error fetching page:', error.name, error.message)
    throw error
  }
}

async function demonstrateCancellation() {
  console.log('Cancellation demo:')

  const controller = new AbortController()

  const promise = fetch('https://httpbin.org/delay/5', {
    signal: controller.signal,
  })

  console.log('Cancelling request...')
  controller.abort()

  try {
    await promise
    console.log('This should not be reached if cancellation works')
  }
  catch (error) {
    // @ts-expect-error -- im fine with ignoring this in a demo
    console.log('Request cancelled successfully:', error.message)
  }
}

async function runDemo() {
  console.log('📊 Fetches Library Demo')

  console.log('First request (no cache)...')
  const start1 = performance.now()
  const data1 = await fetchExamplePage()
  console.log(`Time: ${(performance.now() - start1).toFixed(2)}ms`)
  console.log('Parsed data:', data1)

  console.log('Second request (with cache)...')
  const start2 = performance.now()
  const data2 = await fetchExamplePage()
  console.log(`Time: ${(performance.now() - start2).toFixed(2)}ms`)
  console.log('Parsed data (from cache):', data2)

  await demonstrateCancellation()
}

runDemo().catch(console.error)
