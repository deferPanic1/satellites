import { useEffect, useRef, useState } from 'react'
import {
  IconChevronDown,
  IconFocusCentered,
  IconLayersIntersect,
  IconWorld,
} from '@tabler/icons-react'
import { ConstellationScene, type SceneOptions } from '../lib/cesiumScene'
import { useProject } from '../stores/project'
import { playbackTime } from '../stores/playback'
import s from './GlobeView.module.css'

const LAYERS: { key: keyof SceneOptions; label: string }[] = [
  { key: 'showRoute', label: 'маршрут' },
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
    showRoute: true,
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

  return (
    <div className={s.wrap}>
      <div ref={container} className={s.globe} />

      {stale && (
        <div className={s.stale}>
          Геометрия обновлена · сеть и маршрут ждут пересчёта
        </div>
      )}

      <details className={s.layers}>
        <summary>
          <IconLayersIntersect size={15} />
          Слои
          <IconChevronDown className={s.chevron} size={14} />
        </summary>
        <div className={s.layerMenu}>
          {LAYERS.map((l) => (
            <label key={l.key}>
              <input
                type="checkbox"
                checked={options[l.key]}
                onChange={(e) => setOptions((o) => ({ ...o, [l.key]: e.target.checked }))}
              />
              {l.label}
            </label>
          ))}
        </div>
      </details>

      <div className={s.legend}>
        {LEGEND.map((x) => (
          <span key={x.label}>
            <i className={`${s.dot} ${x.cls}`} /> {x.label}
          </span>
        ))}
      </div>
      <div className={s.cameraControls}>
        <button
          type="button"
          disabled={!selectedClient}
          onClick={() => selectedClient && sceneRef.current?.flyToGround(selectedClient)}
          title={selectedClient ? `Показать ${selectedClient} на карте` : 'Выберите наземный пункт'}
        >
          <IconFocusCentered size={14} />
          <span className={s.cameraLabel}>
            {selectedClient ? `Показать ${selectedClient}` : 'Показать пункт'}
          </span>
        </button>
        <button type="button" onClick={() => sceneRef.current?.resetView()} title="Вернуть общий вид">
          <IconWorld size={14} />
          <span className={s.cameraLabel}>Общий вид</span>
        </button>
      </div>
    </div>
  )
}
