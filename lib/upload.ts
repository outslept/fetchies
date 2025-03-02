import type { UploadOptions } from './types.js'
import { FetchesNetworkError, FetchesResponseError, FetchesTimeoutError } from './errors.js'

export async function uploadFile(url: string, file: File | Blob | Array<File | Blob>, options: UploadOptions = {}): Promise<Response> {
  const formData = new FormData()

  if (Array.isArray(file)) {
    file.forEach((f, index) => {
      formData.append(`file${index}`, f)
    })
  }
  else {
    formData.append('file', file)
  }

  if (options.fields) {
    Object.entries(options.fields).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach(v => formData.append(key, v))
      }
      else {
        formData.append(key, value)
      }
    })
  }

  const xhr = new XMLHttpRequest()

  return new Promise((resolve, reject) => {
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && options.onProgress) {
        const progress = (event.loaded / event.total) * 100
        options.onProgress(progress)
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(
          new Response(xhr.response, {
            status: xhr.status,
            statusText: xhr.statusText,
            headers: new Headers(options.headers),
          }),
        )
      }
      else {
        let responseData
        try {
          responseData = JSON.parse(xhr.response)
        }
        catch {
          responseData = xhr.response
        }

        reject(
          new FetchesResponseError(
            new Response(xhr.response, {
              status: xhr.status,
              statusText: xhr.statusText,
              headers: new Headers(options.headers),
            }),
            responseData,
          ),
        )
      }
    })

    xhr.addEventListener('error', () => {
      reject(new FetchesNetworkError('Upload failed'))
    })

    xhr.addEventListener('timeout', () => {
      reject(new FetchesTimeoutError('Upload timed out'))
    })

    xhr.addEventListener('abort', () => {
      reject(new Error('Upload aborted'))
    })

    xhr.open('POST', url)
    xhr.timeout = options.timeout ?? 30000

    if (options.headers) {
      Object.entries(options.headers).forEach(([key, value]) => {
        if (key.toLowerCase() !== 'content-type') { // Не устанавливаем Content-Type для FormData
          xhr.setRequestHeader(key, value as string)
        }
      })
    }

    xhr.send(formData)
  })
}

export function createUploader() {
  const xhrList: XMLHttpRequest[] = []

  const upload = async (
    url: string,
    file: File | Blob | Array<File | Blob>,
    options: UploadOptions & { fields?: Record<string, any> } = {},
  ): Promise<Response> => {
    const xhr = new XMLHttpRequest()
    xhrList.push(xhr)

    const uploadPromise = uploadFile(url, file, { ...options, xhr })

    uploadPromise.finally(() => {
      const index = xhrList.indexOf(xhr)
      if (index !== -1) {
        xhrList.splice(index, 1)
      }
    })

    return uploadPromise
  }

  const cancelAll = () => {
    xhrList.forEach((xhr) => {
      if (xhr.readyState !== XMLHttpRequest.DONE) {
        xhr.abort()
      }
    })
    xhrList.length = 0
  }

  return {
    upload,
    cancelAll,
  }
}
