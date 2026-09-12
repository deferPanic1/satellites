import { useMemo, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Button,
  NumberInput,
  SegmentedControl,
  Select,
  Slider,
} from '@mantine/core'
import { IconPlus, IconX } from '@tabler/icons-react'
import { useProject } from '../stores/project'
import type { RoutingMode } from '../types/api'
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

export function ConfigPanel() {
  const scenario = useProject((x) => x.scenario)
  const errors = useProject((x) => x.errors)
  const warnings = useProject((x) => x.warnings)
  const routing = useProject((x) => x.routing)
  const gateways = useProject((x) => x.gateways)
  const envBaseline = useProject((x) => x.envBaseline)

  const [failSat, setFailSat] = useState<string | null>(null)
  const [failStartH, setFailStartH] = useState<number>(6)
  const [failEndH, setFailEndH] = useState<number>(24)

  const satOptions = useMemo(
    () => scenario?.design.satellites.map((x) => x.id) ?? [],
    [scenario],
  )

  const activeCount = useMemo(() => {
    if (!scenario) return 0
    return scenario.design.satellites.filter(
      (x) => x.launch_batch <= scenario.design.launch_stage,
    ).length
  }, [scenario])

  if (!scenario) {
    return <div className={`${s.panel} ${s.empty}`}>Загрузите сценарий, чтобы начать</div>
  }

  const p = useProject.getState()

  function addFailure() {
    if (!failSat) return
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
          Активно {activeCount} из {scenario.design.satellites.length}
        </p>
      </section>

      <section>
        <h3>Орбитальные плоскости</h3>
        {scenario.design.planes.map((plane) => (
          <div key={plane.id} className={s.plane}>
            <div className={s.planeHead}>
              <strong>{plane.id}</strong>
              <span className={s.hint}>
                RAAN {plane.raan_deg.toFixed(1)}° · фаза {plane.phase_deg.toFixed(1)}°
              </span>
            </div>
            <label>RAAN</label>
            <Slider
              value={plane.raan_deg}
              min={0}
              max={359.9}
              step={0.5}
              label={null}
              onChange={(v) => p.setPlane(plane.id, 'raan_deg', v)}
            />
            <label>Фазирование</label>
            <Slider
              value={plane.phase_deg}
              min={0}
              max={359.9}
              step={0.5}
              label={null}
              onChange={(v) => p.setPlane(plane.id, 'phase_deg', v)}
            />
          </div>
        ))}
        <p className={s.hint}>
          RAAN поворачивает плоскость вокруг оси Земли, фазирование сдвигает аппараты вдоль неё.
        </p>
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
        <h3>Отказы аппаратов</h3>
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
            w="6rem"
            onChange={(v) => setFailStartH(Number(v) || 0)}
          />
          <NumberInput
            value={failEndH}
            min={0}
            max={24}
            suffix=" ч"
            w="6rem"
            onChange={(v) => setFailEndH(Number(v) || 0)}
          />
          <ActionIcon variant="filled" disabled={!failSat} onClick={addFailure} aria-label="добавить">
            <IconPlus size={14} />
          </ActionIcon>
        </div>

        {scenario.failures.length ? (
          <ul className={s.outages}>
            {scenario.failures.map((f, i) => (
              <li key={`${f.satellite_id}-${i}`}>
                <span className={s.mono}>{f.satellite_id}</span>
                <span className={s.hint}>
                  {fmtH(f.start_s)} — {fmtH(f.end_s)}
                </span>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  radius="xl"
                  onClick={() => p.removeFailure(i)}
                  aria-label="удалить"
                >
                  <IconX size={14} />
                </ActionIcon>
              </li>
            ))}
          </ul>
        ) : (
          <p className={s.hint}>Отказов не задано</p>
        )}
      </section>

      <section>
        <h3>Отказы шлюзов</h3>
        {scenario.gateway_outages.length > 0 && (
          <ul className={s.outages}>
            {scenario.gateway_outages.map((g, i) => (
              <li key={`${g.gateway_id}-${i}`}>
                <span className={s.mono}>{g.gateway_id}</span>
                <span className={s.hint}>
                  {fmtH(g.start_s)} — {fmtH(g.end_s)}
                </span>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  radius="xl"
                  onClick={() => p.removeGatewayOutage(i)}
                  aria-label="удалить"
                >
                  <IconX size={14} />
                </ActionIcon>
              </li>
            ))}
          </ul>
        )}
        <div className={s.failForm}>
          <Button
            variant="outline"
            disabled={!gateways.length}
            onClick={() => p.addGatewayOutage(gateways[0].id, 0, 21600)}
          >
            Выключить шлюз на 0–6 ч
          </Button>
        </div>
      </section>

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

        <p className={s.hint}>
          Набор кейса задаёт дальность 3000 или 2000 км (сценарии 01 и 04) и порог 10°. Отметки
          на шкалах — эти значения. Промежуточные точки показывают, где именно рвётся сквозной
          маршрут; отклонение от набора отмечается в подписи сохранённого варианта.
        </p>
      </section>

      <section>
        <h3>Параметры расчёта</h3>
        <dl className={s.facts}>
          <dt>Высота</dt>
          <dd>{scenario.environment.altitude_km} км</dd>
          <dt>Наклонение</dt>
          <dd>{scenario.environment.inclination_deg}°</dd>
          <dt>Поворот Земли в t=0</dt>
          <dd>{scenario.environment.earth_angle0_deg}°</dd>
          <dt>Горизонт / шаг</dt>
          <dd>
            {scenario.environment.horizon_s / 3600} ч / {scenario.environment.step_s} с
          </dd>
          <dt>Целевая доступность</dt>
          <dd>{(scenario.environment.target_availability * 100).toFixed(0)} %</dd>
        </dl>
        <p className={s.hint}>
          Эти параметры кейс фиксирует: высота и наклонение задают саму задачу, а общий горизонт
          и шаг — условие сравнения вариантов на одном периоде расчёта.
        </p>
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
