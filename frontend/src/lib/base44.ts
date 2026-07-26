import { createClient } from '@base44/sdk'

const appId = import.meta.env.VITE_BASE44_APP_ID

export const base44 = appId
  ? createClient({
      appId,
      appBaseUrl: 'https://app.base44.com',
      options: {
        onError: (error) => console.error('Witness backend request failed', error),
      },
    })
  : null

export function requireBase44() {
  if (!base44) {
    throw new Error('Witness is not configured. Set VITE_BASE44_APP_ID before starting the frontend.')
  }

  return base44
}
