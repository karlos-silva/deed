import { cookies } from 'next/headers'
import { type Db, serverDb } from '@deed/db'

// The Next half of the cookie bridge: a Server Component may read cookies but never write them.
export async function requestDb(): Promise<Db> {
  const store = await cookies()
  return serverDb({
    getAll: () => store.getAll().map(({ name, value }) => ({ name, value })),
    setAll: (written) => {
      for (const cookie of written) {
        try {
          store.set({ name: cookie.name, value: cookie.value, ...(cookie.options ?? {}) })
        } catch {
          // Expected in a Server Component; the middleware refreshes instead.
        }
      }
    },
  })
}
