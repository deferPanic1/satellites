import { useRef, useState } from 'react'
import { Badge, Button, Progress, Select, Tabs } from '@mantine/core'
import { IconUpload } from '@tabler/icons-react'
import { GlobeView } from './components/GlobeView'
import { TimelineBar } from './components/TimelineBar'
import { ConfigPanel } from './components/ConfigPanel'
import { MetricsPanel } from './components/MetricsPanel'
import { InspectorPanel } from './components/InspectorPanel'
import { RecomputeBar } from './components/RecomputeBar'
import { useProject } from './stores/project'
import s from './App.module.css'

const BUILTIN = [
  { label: '01 · Полная группировка', value: '01_full_constellation' },
  { label: '02 · Первая очередь', value: '02_first_launch' },
  { label: '03 · Отказ 10 аппаратов', value: '03_satellite_outages' },
  { label: '04 · ISL 2000 км', value: '04_link_range' },
]

export function App() {
  const scenario = useProject((x) => x.scenario)
  const result = useProject((x) => x.result)
  const busy = useProject((x) => x.busy)
  const notice = useProject((x) => x.notice)
  const usingMock = useProject((x) => x.usingMock)
  const clients = useProject((x) => x.clients)
  const selectedClient = useProject((x) => x.selectedClient)
  const setSelectedClient = useProject((x) => x.setSelectedClient)
  const loadBuiltin = useProject((x) => x.loadBuiltin)
  const loadFile = useProject((x) => x.loadFile)

  // Сценарий не подставляется сам: пока пользователь не выбрал файл,
  // считать нечего. Расчёт запускается загрузкой, как описывает кейс.
  const [builtin, setBuiltin] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) void loadFile(f)
    e.target.value = ''
  }

  function pickBuiltin(v: string | null) {
    if (!v) return
    setBuiltin(v)
    void loadBuiltin(v)
  }

  return (
    <div className={s.app}>
      <header className={s.header}>
        <div className={s.brand}>
          <span className={s.logo}>◎</span>
          <div>
            <h1>Проектирование спутниковой группировки</h1>
            {scenario && <p>{scenario.meta.title}</p>}
          </div>
        </div>

        <div className={s.actions}>
          <Select
            value={builtin}
            data={BUILTIN}
            placeholder="сценарий из набора"
            allowDeselect={false}
            w="14rem"
            onChange={pickBuiltin}
          />
          <Button
            variant="outline"
            leftSection={<IconUpload size={14} />}
            onClick={() => fileInput.current?.click()}
          >
            Загрузить JSON
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={onFile}
          />

          {clients.length > 0 && (
            <Select
              value={selectedClient}
              data={clients.map((c) => c.id)}
              placeholder="пункт"
              allowDeselect={false}
              w="7rem"
              onChange={setSelectedClient}
            />
          )}

          {usingMock && (
            <Badge color="yellow" variant="light">
              демо-данные
            </Badge>
          )}
          {result && (
            <Badge color="gray" variant="light">
              {result.meta.computed_ms?.toFixed(0) ?? '—'} мс
            </Badge>
          )}
        </div>
      </header>

      {busy && <Progress value={100} animated size="xs" radius={0} />}
      {notice && <div className={s.notice}>{notice}</div>}
      <RecomputeBar />

      {!scenario ? (
        <div className={s.start}>
          <span className={s.startLogo}>◎</span>
          <h2>Загрузите проект группировки</h2>
          <p>
            Сервис прочитает сценарий, рассчитает состояние сети на сутки и покажет покрытие,
            маршруты до шлюза и перерывы связи по каждому наземному пункту.
          </p>
          <div className={s.startActions}>
            <Select
              data={BUILTIN}
              placeholder="выбрать из набора кейса"
              allowDeselect={false}
              size="sm"
              w="18rem"
              onChange={pickBuiltin}
            />
            <Button
              size="sm"
              variant="outline"
              leftSection={<IconUpload size={16} />}
              onClick={() => fileInput.current?.click()}
            >
              Загрузить свой JSON
            </Button>
          </div>
          <p className={s.startHint}>Формат cosmo-A-1.0, UTF-8.</p>
        </div>
      ) : (
        <main className={s.main}>
          <aside className={`${s.aside} ${s.left}`}>
            <ConfigPanel />
          </aside>

          <section className={s.center}>
            <GlobeView />
            <TimelineBar />
          </section>

          <aside className={`${s.aside} ${s.right}`}>
            <Tabs defaultValue="metrics" classNames={{ root: s.tabs, panel: s.tabPanel }}>
              <Tabs.List>
                <Tabs.Tab value="metrics">Показатели</Tabs.Tab>
                <Tabs.Tab value="inspect">Маршрут</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="metrics">
                <MetricsPanel />
              </Tabs.Panel>
              <Tabs.Panel value="inspect">
                <InspectorPanel />
              </Tabs.Panel>
            </Tabs>
          </aside>
        </main>
      )}
    </div>
  )
}
