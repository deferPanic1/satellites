import { useMemo, useState } from 'react'
import {
  ActionIcon,
  Alert,
  NumberInput,
  SegmentedControl,
  Select,
  Slider,
} from '@mantine/core'
import { IconChevronDown, IconPlus, IconX } from '@tabler/icons-react'
import { useProject } from '../stores/project'
import { selectStepIndex, usePlayback } from '../stores/playback'
import { plural } from '../lib/viz'
import type { GatewayOutage, RoutingMode, SatelliteOutage } from '../types/api'
import s from './ConfigPanel.module.css'

const STAGE_OPTIONS = [
  { label: '1 очередь', value: '1' },
  { label: '2 очереди', value: '2' },
  { label: '3 очереди', value: '3' },
]

const ROUTING_OPTIONS = [
  { label: 'мин. переходов', value: 'min_hops' },
  { label: 'мин. дистанция', value: 'min_distance' },
]

const fmtH = (sec: number) => `${(sec / 3600).toFixed(1)} ч`

type OutageState = 'past' | 'now' | 'later'

/** Где текущий момент относительно периода недоступности. */
function outageState(o: { start_s: number; end_s: number }, tNow: number): OutageState {
  if (o.end_s <= tNow) return 'past'
  if (o.start_s > tNow) return 'later'
  return 'now'
}

const STATE_LABEL: Record<OutageState, string> = {
  past: 'завершён',
  now: 'сейчас',
  later: 'позже',
}

/**
 * Список периодов в хронологическом порядке, но с исходным индексом:
 * удаление работает по позиции в сценарии, а читать удобнее по времени.
 */
function chronological<T extends { start_s: number }>(list: T[]): { item: T; index: number }[] {
  return list
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.start_s - b.item.start_s)
}

export function ConfigPanel() {
  const scenario = useProject((x) => x.scenario)
  const errors = useProject((x) => x.errors)
  const warnings = useProject((x) => x.warnings)
  const routing = useProject((x) => x.routing)
  const clients = useProject((x) => x.clients)
  const gateways = useProject((x) => x.gateways)
  const committed = useProject((x) => x.committed)
  const envBaseline = useProject((x) => x.envBaseline)

  /**
   * Раскрытая плоскость. Свёрнуты по умолчанию: в наборе кейса их три, но
   * формат допускает любое число, и плоский список из пар ползунков быстро
   * превращается в простыню. Открыта одна за раз — так панель не растёт.
   */
  const [openPlane, setOpenPlane] = useState<string | null>(null)

  const [failSat, setFailSat] = useState<string | null>(null)
  const [failStartH, setFailStartH] = useState<number>(6)
  const [failEndH, setFailEndH] = useState<number>(24)

  /**
   * Состав активных аппаратов зависит от момента времени, а не только от
   * очереди запуска: периоды недоступности начинаются и заканчиваются внутри
   * суток. Подписываемся на индекс отсчёта, а не на непрерывное время —
   * состояние сети всё равно меняется только на сетке.
   */
  const stepIndex = usePlayback(selectStepIndex)
  const stepS = usePlayback((x) => x.stepS)
  const seek = usePlayback((x) => x.seek)
  const tNow = stepIndex * stepS

  const satOptions = useMemo(
    () => scenario?.design.satellites.map((x) => x.id) ?? [],
    [scenario],
  )

  /**
   * Сколько аппаратов работает ИМЕННО СЕЙЧАС.
   *
   * Раньше здесь считались только выведенные на орбиту, без учёта отказов.
   * Из-за этого сценарий «03 Отказ 10 аппаратов» показывал «Активно 48 из 48»
   * и все аппараты белыми — что формально верно для t = 0 (отказы в этом
   * сценарии начинаются с шестого часа), но выглядело так, будто отказы
   * просто проигнорированы. Теперь видно и текущее число, и когда оно изменится.
   */
  const fleet = useMemo(() => {
    if (!scenario) return null
    const launched = scenario.design.satellites.filter(
      (x) => x.launch_batch <= scenario.design.launch_stage,
    )
    const launchedIds = new Set(launched.map((x) => x.id))
    const failedNow = new Set(
      scenario.failures
        .filter((f) => f.start_s <= tNow && tNow < f.end_s && launchedIds.has(f.satellite_id))
        .map((f) => f.satellite_id),
    )
    const upcoming = scenario.failures.filter(
      (f) => f.start_s > tNow && launchedIds.has(f.satellite_id),
    )
    const nextStart = upcoming.length ? Math.min(...upcoming.map((f) => f.start_s)) : null
    const nextCount =
      nextStart === null
        ? 0
        : new Set(upcoming.filter((f) => f.start_s === nextStart).map((f) => f.satellite_id)).size

    return {
      total: scenario.design.satellites.length,
      launched: launched.length,
      failedNow: failedNow.size,
      activeNow: launched.length - failedNow.size,
      nextStart,
      nextCount,
    }
  }, [scenario, tNow])

  if (!scenario) {
    return <div className={`${s.panel} ${s.empty}`}>Загрузите сценарий, чтобы начать</div>
  }

  const p = useProject.getState()
  const rangeValid = failStartH < failEndH

  function addFailure() {
    if (!failSat || !rangeValid) return
    p.addFailure(failSat, failStartH * 3600, failEndH * 3600)
  }

  return (
    <div className={s.panel}>
      <section>
        <h3>Этап развёртывания</h3>
        <SegmentedControl
          fullWidth
          value={String(scenario.design.launch_stage)}
          data={STAGE_OPTIONS}
          onChange={(v) => p.setLaunchStage(Number(v))}
        />
        <p className={s.hint}>
          Активно {fleet?.activeNow ?? 0} из {fleet?.total ?? 0}
          {fleet && fleet.failedNow > 0 && ` · в отказе ${fleet.failedNow}`}
          {fleet && fleet.launched < fleet.total && ` · не выведено ${fleet.total - fleet.launched}`}
        </p>
        {fleet?.nextStart != null && (
          <button
            type="button"
            className={s.timeHint}
            onClick={() => seek(fleet.nextStart as number)}
            title="перейти к этому моменту"
          >
            {fleet.nextCount === 1 ? 'Ещё 1 аппарат уходит' : `Ещё ${fleet.nextCount} аппаратов уходят`}{' '}
            в отказ в {fmtH(fleet.nextStart)} →
          </button>
        )}
      </section>

      <section>
        <div className={s.sectionHead}>
          <h3>Орбитальные плоскости</h3>
          <span className={s.count}>{scenario.design.planes.length}</span>
        </div>
        <div className={s.planes}>
          {scenario.design.planes.map((plane) => {
            const open = plane.id === openPlane
            // значения расходятся с посчитанными — правка ждёт пересчёта
            const c = committed?.design.planes.find((x) => x.id === plane.id)
            const dirty = Boolean(
              c && (c.raan_deg !== plane.raan_deg || c.phase_deg !== plane.phase_deg),
            )
            return (
              <div key={plane.id} className={s.planeItem} data-open={open || undefined}>
                <button
                  type="button"
                  className={s.planeBtn}
                  aria-expanded={open}
                  onClick={() => setOpenPlane(open ? null : plane.id)}
                >
                  <span className={s.planeId}>{plane.id}</span>
                  {dirty && <i className={s.dirty} title="изменено, ждёт пересчёта" />}
                  <span className={s.planeVals}>
                    RAAN {plane.raan_deg.toFixed(1)}° · фаза {plane.phase_deg.toFixed(1)}°
                  </span>
                  <IconChevronDown size={13} className={s.planeChev} />
                </button>

                {open && (
                  <div className={s.planeBody}>
                    <label className={s.fieldLabel}>RAAN</label>
                    <Slider
                      value={plane.raan_deg}
                      min={0}
                      max={359.9}
                      step={0.5}
                      label={null}
                      onChange={(v) => p.setPlane(plane.id, 'raan_deg', v)}
                    />
                    <label className={s.fieldLabel}>Фазирование</label>
                    <Slider
                      value={plane.phase_deg}
                      min={0}
                      max={359.9}
                      step={0.5}
                      label={null}
                      onChange={(v) => p.setPlane(plane.id, 'phase_deg', v)}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <h3>Стратегия маршрутизации</h3>
        <SegmentedControl
          fullWidth
          value={routing}
          data={ROUTING_OPTIONS}
          onChange={(v) => p.setRouting(v as RoutingMode)}
        />
      </section>

      <section>
        <h3>
          Отказы аппаратов
          {scenario.failures.length > 0 && (
            <span className={s.count}>{scenario.failures.length}</span>
          )}
        </h3>
        <div className={s.failForm}>
          <Select
            value={failSat}
            data={satOptions}
            placeholder="спутник"
            searchable
            className={s.grow}
            onChange={setFailSat}
          />
          <NumberInput
            value={failStartH}
            min={0}
            max={24}
            suffix=" ч"
            className={s.hours}
            onChange={(v) => setFailStartH(Number(v) || 0)}
          />
          <NumberInput
            value={failEndH}
            min={0}
            max={24}
            suffix=" ч"
            className={s.hours}
            onChange={(v) => setFailEndH(Number(v) || 0)}
          />
          <ActionIcon
            variant="filled"
            disabled={!failSat || !rangeValid}
            onClick={addFailure}
            aria-label="добавить"
          >
            <IconPlus size={14} />
          </ActionIcon>
        </div>

        {!rangeValid && (
          <p className={s.warn}>Начало периода должно быть раньше конца</p>
        )}

        {scenario.failures.length ? (
          <ul className={s.outages}>
            {chronological<SatelliteOutage>(scenario.failures).map(({ item: f, index }) => {
              const state = outageState(f, tNow)
              return (
                <li key={`${f.satellite_id}-${f.start_s}-${f.end_s}`} data-state={state}>
                  <button
                    type="button"
                    className={s.outageMain}
                    onClick={() => seek(f.start_s)}
                    title="перейти к началу периода"
                  >
                    <span className={s.mono}>{f.satellite_id}</span>
                    <span className={s.range}>
                      {fmtH(f.start_s)} — {fmtH(f.end_s)}
                    </span>
                    <span className={s.state}>
                      {state === 'later' ? `с ${fmtH(f.start_s)}` : STATE_LABEL[state]}
                    </span>
                  </button>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    radius="xl"
                    onClick={() => p.removeFailure(index)}
                    aria-label="удалить"
                  >
                    <IconX size={14} />
                  </ActionIcon>
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>

      {/*
        Периоды недоступности шлюза не редактируются: в проекте единственный
        шлюз выхода в наземную сеть, и его отключение — не проектное решение,
        а авария. Само поле сценария при этом поддерживается: формат
        cosmo-A-1.0 его содержит, расчёт учитывает, причина gw_down
        классифицируется. Если загруженный файл задаёт такие периоды, они
        показываются здесь только для чтения.
      */}
      {scenario.gateway_outages.length > 0 && (
        <section>
          <h3>
            Недоступность шлюзов
            <span className={s.count}>{scenario.gateway_outages.length}</span>
          </h3>
          <ul className={s.outages}>
            {chronological<GatewayOutage>(scenario.gateway_outages).map(({ item: g }) => {
              const state = outageState(g, tNow)
              return (
                <li key={`${g.gateway_id}-${g.start_s}-${g.end_s}`} data-state={state}>
                  <button
                    type="button"
                    className={s.outageMain}
                    onClick={() => seek(g.start_s)}
                    title="перейти к началу периода"
                  >
                    <span className={s.mono}>{g.gateway_id}</span>
                    <span className={s.range}>
                      {fmtH(g.start_s)} — {fmtH(g.end_s)}
                    </span>
                    <span className={s.state}>
                      {state === 'later' ? `с ${fmtH(g.start_s)}` : STATE_LABEL[state]}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className={s.hint}>Задано в загруженном сценарии, в интерфейсе не меняется.</p>
        </section>
      )}

      <section>
        <h3>Параметры связи</h3>

        <div className={s.planeHead}>
          <label className={s.inline}>Дальность ISL</label>
          <span className={s.value}>{scenario.environment.isl_range_km} км</span>
        </div>
        <Slider
          value={scenario.environment.isl_range_km}
          min={500}
          max={5000}
          step={100}
          label={null}
          marks={[
            { value: 2000, label: '2000' },
            { value: 3000, label: '3000' },
          ]}
          mb="1.4rem"
          onChange={(v) => p.setEnv('isl_range_km', v)}
        />
        {envBaseline && envBaseline.isl_range_km !== scenario.environment.isl_range_km && (
          <p className={s.changed}>изменено с {envBaseline.isl_range_km} км</p>
        )}

        <div className={s.planeHead}>
          <label className={s.inline}>Порог возвышения</label>
          <span className={s.value}>{scenario.environment.min_elevation_deg}°</span>
        </div>
        <Slider
          value={scenario.environment.min_elevation_deg}
          min={0}
          max={40}
          step={0.5}
          label={null}
          marks={[{ value: 10, label: '10°' }]}
          mb="1.4rem"
          onChange={(v) => p.setEnv('min_elevation_deg', v)}
        />
        {envBaseline && envBaseline.min_elevation_deg !== scenario.environment.min_elevation_deg && (
          <p className={s.changed}>изменено с {envBaseline.min_elevation_deg}°</p>
        )}

      </section>

      <section>
        {/* Эти величины кейс фиксирует, поэтому блок читается, а не редактируется:
            вместо абзаца-объяснения — метка «из сценария» в заголовке. */}
        <div className={s.sectionHead}>
          <h3>Параметры расчёта</h3>
          <span className={s.tag}>из сценария</span>
        </div>
        <dl className={s.facts}>
          <dt>Наземные пункты</dt>
          <dd>
            {clients.length} {plural(clients.length, 'клиент', 'клиента', 'клиентов')} ·{' '}
            {gateways.length} {plural(gateways.length, 'шлюз', 'шлюза', 'шлюзов')}
          </dd>
          <dt>Орбита</dt>
          <dd>
            {scenario.environment.altitude_km} км · {scenario.environment.inclination_deg}°
          </dd>
          <dt>Поворот Земли в t=0</dt>
          <dd>{scenario.environment.earth_angle0_deg}°</dd>
          <dt>Горизонт · шаг</dt>
          <dd>
            {scenario.environment.horizon_s / 3600} ч · {scenario.environment.step_s} с
          </dd>
        </dl>
      </section>

      {errors.map((e, i) => (
        <Alert key={`e${i}`} color="red" variant="light" p="xs">
          <span className={s.mono}>{e.path}</span> — {e.message}
        </Alert>
      ))}
      {warnings.map((w, i) => (
        <Alert key={`w${i}`} color="yellow" variant="light" p="xs">
          {w.message}
        </Alert>
      ))}
    </div>
  )
}
