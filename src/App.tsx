import evalData from '../data/eval.json'
import { CaseStudy } from './components/CaseStudy'
import { Hero } from './components/Hero'
import { Lab } from './components/Lab'
import { Scoreboard } from './components/Scoreboard'
import { Workbench } from './components/Workbench'
import { QC } from './lib/readers'

export default function App() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Hero />
      <main id="main">
        <CaseStudy />
        <Lab />
        <Scoreboard />
        <Workbench />
        <How />
      </main>
      <footer className="foot">
        <div className="wrap">
          <p>
            Built by Abdallah Safi for PathoScan's Riipen Level UP project, AI Enhancement for PathoBox. Not made or endorsed by PathoScan. It makes calls on
            colour; it doesn't diagnose anything. <a href="https://github.com/PohTeyToe/riipen-pathoscan">Code and README</a>.
          </p>
          <p>
            Real photos: Bokelmann, Nickel, Maricic, Pääbo, Meyer, Borte and Riesenberg, "Point-of-care bulk testing for SARS-CoV-2 by combining hybridization
            capture with improved colorimetric LAMP", <i>Nature Communications</i> 12, 1467 (2021), Zenodo 4476336, CC0. Those plates are read with SYBR Green I added
            after the run, not phenol red. The case-study chart measures PathoScan's published photo. Everything else is synthetic and drawn by the code in
            the repo.
          </p>
        </div>
      </footer>
    </>
  )
}

const num = (x: number) => (x < 0 ? `−${(-x).toFixed(2)}` : x.toFixed(2))

function How() {
  const m = evalData.params.model
  const steps = [
    ['Find', 'Make the paper neutral, keep pixels that are clearly pink, orange or yellow, and join what glare or a bubble splits.'],
    ['Measure', 'Median colour of the liquid, divided by the paper right beside it so that paper reads white.'],
    ['Scale', `Place each sample between its run's negative (0) and positive (1) control. A two-parameter logistic model (w0 ${num(m.w0)}, w1 ${num(m.w1)}) turns that into p.`],
    ['Call or hold', `Positive at p ≥ ${evalData.params.band.hi}, negative at p ≤ ${evalData.params.band.lo}, held in between. It holds the run if the controls are under ${QC.minControlGap}° apart, and flags a positive control weaker than samples.`],
  ]
  return (
    <section className="how" aria-labelledby="how-h">
      <div className="wrap">
        <p className="eyebrow">How it reads</p>
        <h2 id="how-h">Four steps, in your browser, in milliseconds.</h2>
        <ol className="how-steps">
          {steps.map(([t, d], k) => (
            <li key={t}>
              <span className="how-n">{k + 1}</span>
              <b>{t}</b>
              <span>{d}</span>
            </li>
          ))}
        </ol>
        <p className="limits-h">What it can't tell you</p>
        <ul className="limits">
          <li>Phenol red reads pH, not DNA. An acidic extract can turn a negative orange with no amplification.</li>
          <li>A positive whose colour never changed enough to see looks negative to any colour reader.</li>
          <li>An end photo can't tell a late, non-specific turn from a real one. A frame a minute from the box could.</li>
          <li>Colour isn't severity. This reads tubes; it says nothing about a plant or a field.</li>
          <li>No PathoScan image went into the eval. The synthetic runs follow my assumptions, set out in the README.</li>
        </ul>
      </div>
    </section>
  )
}
