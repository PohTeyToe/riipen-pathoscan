import { useSyncExternalStore } from 'react'
import { Guide } from './Guide'
import { NewRun } from './NewRun'
import { Runs } from './Runs'

// Routes: #/ (runs), #/new, #/run/<id>. The hash keeps every screen inside /app.html, which is what works offline.
const onHash = (f: () => void) => {
  addEventListener('hashchange', f)
  return () => removeEventListener('hashchange', f)
}

export default function App() {
  const hash = useSyncExternalStore(onHash, () => location.hash)
  const run = /^#\/run\/(.+)$/.exec(hash)
  if (hash === '#/new') return <NewRun />
  if (run) return <Guide key={run[1]} id={decodeURIComponent(run[1])} />
  return <Runs />
}
