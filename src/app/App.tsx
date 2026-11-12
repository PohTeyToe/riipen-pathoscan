import { useSyncExternalStore } from 'react'
import { Guide } from './Guide'
import { NewRun } from './NewRun'
import { Runs } from './Runs'
import { useUpdate } from './update'

// Routes: #/ (runs), #/new, #/run/<id>. The hash keeps every screen inside /app.html, which is what works offline.
const onHash = (f: () => void) => {
  addEventListener('hashchange', f)
  return () => removeEventListener('hashchange', f)
}

export default function App() {
  const hash = useSyncExternalStore(onHash, () => location.hash)
  const run = /^#\/run\/(.+)$/.exec(hash)
  const update = useUpdate()
  return (
    <>
      {update && (
        <div className="update" role="status">
          New version ready.
          <button type="button" onClick={update}>
            Reload
          </button>
        </div>
      )}
      {hash === '#/new' ? <NewRun /> : run ? <Guide key={run[1]} id={decodeURIComponent(run[1])} /> : <Runs />}
    </>
  )
}
