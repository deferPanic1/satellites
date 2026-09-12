import { useMemo } from 'react'
import { ActionIcon, Badge } from '@mantine/core'
import { IconX } from '@tabler/icons-react'
import { useProject } from '../stores/project'
import { selectStepIndex, usePlayback } from '../stores/playback'
import { buildModel, elevationDeg, groundPosition, positionOf } from '../lib/orbital'
import s from './InspectorPanel.module.css'

export function InspectorPanel() {
  const scenario = useProject((x) => x.scenario)
  const result = useProject((x) => x.result)
  const selectedSat = useProject((x) => x.selectedSat)
  const selectedClient = useProject((x) => x.selectedClient)
  const setSelectedSat = useProject((x) => x.setSelectedSat)
  const stepAt = useProject((x) => x.stepAt)
  const routeAt = useProject((x) => x.routeAt)

  const t = usePlayback((x) => x.t)
  const stepIndex = usePlayback(selectStepIndex)

  /**
   * Модель пересобирается только при смене сценария — useMemo кеширует.
   * Углы здесь считаются в браузере и служат ТОЛЬКО для справки в панели:
   * все числа, которые идут в метрики и выгрузку, приходят с бэка.
   */
  const model = useMemo(
    () => (scenario ? buildModel(scenario, result?.constants) : null),
    [scenario, result?.constants],
  )

  const step = stepAt(stepIndex)

  const info = useMemo(() => {
    if (!model || !selectedSat || !scenario) return null

    const idx = model.index.get(selectedSat)
    if (idx === undefined) return null
    const meta = scenario.design.satellites[idx]
    const pos = positionOf(model, idx, t)

    const inactive = step?.inactive.includes(selectedSat) ?? false
    const notLaunched = meta.launch_batch > scenario.design.launch_stage
    const failedNow = scenario.failures.some(
      (f) => f.satellite_id === selectedSat && f.start_s <= t && t < f.end_s,
    )

    // соседи по текущему состоянию сети
    const neighbours: { id: string; isIsl: boolean }[] = []
    for (const [a, b] of step?.edges ?? []) {
      const other = a === selectedSat ? b : b === selectedSat ? a : null
      if (!other) continue
      neighbours.push({ id: other, isIsl: model.index.has(other) })
    }

    // над какими пунктами сейчас виден
    const serving = scenario.ground_sites
      .map((g) => ({
        id: g.id,
        role: g.role,
        el: elevationDeg(pos, groundPosition(g.lat_deg, g.lon_deg)),
      }))
      .filter((x) => x.el >= scenario.environment.min_elevation_deg)

    // в чьих маршрутах участвует
    const onRouteFor = Object.entries(result?.routes ?? {})
      .filter(([, arr]) => arr[stepIndex]?.includes(selectedSat))
      .map(([c]) => c)

    return {
      id: selectedSat,
      planeId: meta.plane_id,
      batch: meta.launch_batch,
      slot: meta.slot_deg,
      inactive,
      inactiveReason: notLaunched ? 'не запущен' : failedNow ? 'отказ' : null,
      altitude: Math.hypot(pos.x, pos.y, pos.z) - 6371,
      neighbours,
      serving,
      onRouteFor,
    }
  }, [model, selectedSat, scenario, result, step, stepIndex, t])

  const routeLegs = useMemo(() => {
    const path = routeAt(stepIndex)
    if (!path || !model || !scenario) return []

    const posOf = (id: string) => {
      const i = model.index.get(id)
      if (i !== undefined) return positionOf(model, i, t)
      const g = scenario.ground_sites.find((x) => x.id === id)
      return g ? groundPosition(g.lat_deg, g.lon_deg) : null
    }

    const legs = []
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]
      const b = path[i + 1]
      const pa = posOf(a)
      const pb = posOf(b)
      if (!pa || !pb) continue
      const isSatA = model.index.has(a)
      const isSatB = model.index.has(b)
      legs.push({
        from: a,
        to: b,
        type: isSatA && isSatB ? 'ISL' : i === 0 ? 'uplink' : 'downlink',
        km: Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z),
        interPlane:
          isSatA &&
          isSatB &&
          model.sats[model.index.get(a)!].planeId !== model.sats[model.index.get(b)!].planeId,
      })
    }
    return legs
    // routeAt читает стор через getState(), поэтому в зависимостях result
  }, [model, scenario, result, stepIndex, t, routeAt])

  const totalKm = routeLegs.reduce((a, l) => a + l.km, 0)

  return (
    <div className={s.panel}>
      {routeLegs.length > 0 && (
        <section>
          <h3>Текущий маршрут · {selectedClient}</h3>
          <ol className={s.legs}>
            {routeLegs.map((l, i) => (
              <li key={i}>
                <span className={s.mono}>
                  {l.from} → {l.to}
                </span>
                <Badge
                  size="xs"
                  variant="light"
                  color={l.type === 'ISL' ? 'blue' : 'yellow'}
                >
                  {l.type}
                </Badge>
                {l.interPlane && <span className={s.hint}>между плоскостями</span>}
                <span className={s.km}>{l.km.toFixed(0)} км</span>
              </li>
            ))}
          </ol>
          <p className={s.hint}>
            Всего {routeLegs.length} переходов, {totalKm.toFixed(0)} км, задержка света ≈{' '}
            {(totalKm / 299.792).toFixed(1)} мс в одну сторону. Дистанции пересчитаны в браузере
            для непрерывного времени и могут на доли процента отличаться от табличных значений с
            сервера.
          </p>
        </section>
      )}

      {info && (
        <section>
          <div className={s.head}>
            <h3>Спутник {info.id}</h3>
            <ActionIcon variant="subtle" color="gray" radius="xl" onClick={() => setSelectedSat(null)}>
              <IconX size={14} />
            </ActionIcon>
          </div>

          <div className={s.badges}>
            <Badge variant="light" color="gray">
              {info.planeId}
            </Badge>
            <Badge variant="light" color="gray">
              очередь {info.batch}
            </Badge>
            {info.inactive ? (
              <Badge variant="light" color="red">
                {info.inactiveReason ?? 'неактивен'}
              </Badge>
            ) : (
              <Badge variant="light" color="green">
                активен
              </Badge>
            )}
          </div>

          <dl className={s.facts}>
            <dt>Слот</dt>
            <dd>{info.slot.toFixed(1)}°</dd>
            <dt>Высота</dt>
            <dd>{info.altitude.toFixed(1)} км</dd>
            <dt>Связей сейчас</dt>
            <dd>{info.neighbours.length}</dd>
            <dt>из них ISL</dt>
            <dd>{info.neighbours.filter((n) => n.isIsl).length}</dd>
          </dl>

          {info.serving.length > 0 && (
            <>
              <h4>Виден из пунктов</h4>
              <ul className={s.serving}>
                {info.serving.map((x) => (
                  <li key={x.id}>
                    <span className={s.mono}>{x.id}</span>
                    <span className={s.hint}>{x.role === 'gateway' ? 'шлюз' : 'клиент'}</span>
                    <span className={s.km}>{x.el.toFixed(1)}°</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {info.onRouteFor.length > 0 && (
            <p className={s.onRoute}>
              Участвует в маршруте: <span className={s.mono}>{info.onRouteFor.join(', ')}</span>
            </p>
          )}
        </section>
      )}

      {!info && routeLegs.length === 0 && (
        <p className={`${s.hint} ${s.center}`}>
          Кликните по спутнику на глобусе, чтобы увидеть его состояние.
        </p>
      )}
    </div>
  )
}
