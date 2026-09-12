import { useEffect, useRef, useState } from 'react'
import { ConstellationScene, type SceneOptions } from '../lib/cesiumScene'
import { useProject } from '../stores/project'
import { playbackTime } from '../stores/playback'
import s from './GlobeView.module.css'

const LAYERS: { key: keyof SceneOptions; label: string }[] = [
  { key: 'showIsl', label: 'межспутниковые' },
  { key: 'showGroundLinks', label: 'наземные' },
  { key: 'showOrbits', label: 'орбиты' },
  { key: 'showLabels', label: 'подписи' },
]

const LEGEND = [
  { cls: s.route, label: 'маршрут' },
  { cls: s.isl, label: 'ISL' },
  { cls: s.ground, label: 'наземная линия' },
  { cls: s.gw, label: 'шлюз' },
  { cls: s.client, label: 'клиент' },
  { cls: s.off, label: 'неактивен' },
]

export function GlobeView() {
  const container = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<ConstellationScene | null>(null)

  const scenario = useProject((x) => x.scenario)
  const selectedClient = useProject((x) => x.selectedClient)
  const stale = useProject((x) => x.stale)

  const [options, setOptions] = useState<SceneOptions>({
    showLabels: false,
    showOrbits: true,
    showIsl: true,
    showGroundLinks: true,
  })
  /** Кадровый цикл живёт вне React, ему нужна свежая копия настроек. */
  const optionsRef = useRef(options)
  optionsRef.current = options

  // Сцена создаётся один раз. Кадровый цикл читает сторы через getState():
  // подписка React здесь не нужна и только гнала бы рендер на 60 fps.
  useEffect(() => {
    const el = container.current
    if (!el) return

    const scene = new ConstellationScene(el)
    sceneRef.current = scene
    scene.onSatelliteClick((id) => useProject.getState().setSelectedSat(id))

    const { scenario: sc, result } = useProject.getState()
    if (sc) scene.setScenario(sc, result?.constants)

    const observer = new ResizeObserver(() => scene.resize())
    observer.observe(el)

    // переиспользуемое множество: 60 раз в секунду плодить новое незачем
    const inactive = new Set<string>()

    let raf = 0
    const frame = () => {
      const p = useProject.getState()
      const t = playbackTime.t
      const stepIndex = Math.floor(t / (p.stepS || 120))

      // состав активных считается из черновика: он верен сразу после правки
      inactive.clear()
      const sc = p.scenario
      if (sc) {
        for (const sat of sc.design.satellites) {
          if (sat.launch_batch > sc.design.launch_stage) inactive.add(sat.id)
        }
        for (const f of sc.failures) {
          if (f.start_s <= t && t < f.end_s) inactive.add(f.satellite_id)
        }
      }

      scene.update({
        t,
        step: p.stepAt(stepIndex),
        route: p.routeAt(stepIndex),
        selectedSat: p.selectedSat,
        inactive,
        stale: p.stale,
        options: optionsRef.current,
      })
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      scene.destroy()
      sceneRef.current = null
    }
  }, [])

  // пересобираем сцену при смене сценария (изменились RAAN, фазы, состав)
  useEffect(() => {
    if (scenario && sceneRef.current) {
      sceneRef.current.setScenario(scenario, useProject.getState().result?.constants)
    }
  }, [scenario])

  useEffect(() => {
    if (selectedClient) sceneRef.current?.flyToGround(selectedClient)
  }, [selectedClient])

  return (
    <div className={s.wrap}>
      <div ref={container} className={s.globe} />

      {stale && (
        <div className={s.stale}>
          Геометрия обновлена · сеть и маршрут ждут пересчёта
        </div>
      )}

      <div className={s.toggles}>
        {LAYERS.map((l) => (
          <label key={l.key}>
            <input
              type="checkbox"
              checked={options[l.key]}
              onChange={(e) => setOptions((o) => ({ ...o, [l.key]: e.target.checked }))}
            />{' '}
            {l.label}
          </label>
        ))}
      </div>

      <div className={s.legend}>
        {LEGEND.map((x) => (
          <span key={x.label}>
            <i className={`${s.dot} ${x.cls}`} /> {x.label}
          </span>
        ))}
      </div>
    </div>
  )
}
