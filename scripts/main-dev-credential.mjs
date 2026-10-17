import { statSync } from 'node:fs'
import { join } from 'node:path'

export function resolveDevCredential(env, stat = statSync) {
  const exists = path => { try { return !!path && stat(path).isFile() } catch { return false } }
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    if (exists(env.GOOGLE_APPLICATION_CREDENTIALS)) return env.GOOGLE_APPLICATION_CREDENTIALS
    throw Error('GOOGLE_APPLICATION_CREDENTIALS points to a missing file. Correct that variable before starting Main.')
  }
  const candidates = [
    env.APPDATA && join(env.APPDATA,'gcloud','application_default_credentials.json'),
    env.USERPROFILE && join(env.USERPROFILE,'AppData','Roaming','gcloud','application_default_credentials.json'),
    env.HOME && join(env.HOME,'.config','gcloud','application_default_credentials.json'),
  ].filter(Boolean)
  const found = candidates.find(exists)
  if (!found) throw Error('Main Google credentials are unavailable for this terminal. Existing login credentials must be restored before the Firebase API can start. No database request was made.')
  return found
}
