/** Query parameter that carries the one-time launch token of `dsh web`. */
const TOKEN_PARAM = 'token'

export interface ParsedTarget {
  /** Origin of the host, e.g. `http://127.0.0.1:3080`. Used to fence navigation. */
  origin: string
  /** URL to load. May contain the launch token so the first request can sign in. */
  loadUrl: string
  /** URL to probe and to persist. Never contains a launch token or fragment. */
  cleanUrl: string
}

/**
 * Turns user input into a target. Throws an Error with a user-facing message for invalid input.
 * A missing scheme defaults to `http://` because hosts are usually plain-HTTP loopback addresses.
 */
export function parseTargetUrl(input: string): ParsedTarget {
  const trimmed = input.trim()
  if (trimmed === '') {
    throw new Error('Enter the address of the DSH web UI.')
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new Error('This is not a valid address.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https addresses are supported.')
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('Addresses with embedded credentials are not supported.')
  }

  const clean = new URL(url.href)
  clean.searchParams.delete(TOKEN_PARAM)
  clean.hash = ''

  return {
    origin: url.origin,
    loadUrl: url.href,
    cleanUrl: clean.href
  }
}
