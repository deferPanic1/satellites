import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Progress, Select, Tabs } from '@mantine/core'
import { useHotkeys } from '@mantine/hooks'
import {
  IconChartBar,
  IconChevronLeft,
  IconChevronRight,
  IconRoute,
  IconSettings,
  IconUpload,
} from '@tabler/icons-react'
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

/** Состояние панелей переживает перезагрузку: разметка — привычка, а не настройка сценария. */
function useStickyFlag(key: string, initial: boolean) {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? initial : raw === '1'
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, value ? '1' : '0')
    } catch {
      /* приватный режим — просто не запоминаем */
    }
  }, [key, value])
  return [value, setValue] as const
}

export function App() {
  const scenario = useProject((x) => x.scenario)
  const busy = useProject((x) => x.busy)
  const notice = useProject((x) => x.notice)
  const errors = useProject((x) => x.errors)
  const warnings = useProject((x) => x.warnings)
  const clients = useProject((x) => x.clients)
  const selectedClient = useProject((x) => x.selectedClient)
  const setSelectedClient = useProject((x) => x.setSelectedClient)
  const loadBuiltin = useProject((x) => x.loadBuiltin)
  const loadFile = useProject((x) => x.loadFile)

  // Сценарий не подставляется сам: пока пользователь не выбрал файл,
  // считать нечего. Расчёт запускается загрузкой, как описывает кейс.
  const [builtin, setBuiltin] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const [leftOpen, setLeftOpen] = useStickyFlag('ui.panel.left', true)
  const [rightOpen, setRightOpen] = useStickyFlag('ui.panel.right', true)
  const [rightTab, setRightTab] = useState<string | null>('metrics')

  useHotkeys([
    ['[', () => setLeftOpen((v) => !v)],
    [']', () => setRightOpen((v) => !v)],
  ])

  /** Клик по иконке свёрнутой правой панели открывает сразу нужную вкладку. */
  function openRight(tab: string) {
    setRightTab(tab)
    setRightOpen(true)
  }

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
          {(errors.length > 0 || warnings.length > 0) && (
            <div className={s.startMessages}>
              {errors.map((error, index) => (
                <Alert key={`error-${index}`} color="red" variant="light" title={error.path}>
                  {error.message}
                </Alert>
              ))}
              {warnings.map((warning, index) => (
                <Alert key={`warning-${index}`} color="yellow" variant="light" title={warning.path}>
                  {warning.message}
                </Alert>
              ))}
            </div>
          )}
        </div>
      ) : (
        <main
          className={s.main}
          data-left={leftOpen ? 'open' : 'collapsed'}
          data-right={rightOpen ? 'open' : 'collapsed'}
        >
          <aside
            className={`${s.aside} ${s.left}`}
            data-collapsed={leftOpen ? undefined : ''}
          >
            <div className={s.asideBody} inert={!leftOpen}>
              <ConfigPanel />
            </div>

            <div className={s.rail}>
              <button
                type="button"
                className={s.railBtn}
                onClick={() => setLeftOpen(true)}
                title="Развернуть параметры · ["
              >
                <IconSettings size={17} />
                <span className={s.railLabel}>Параметры</span>
              </button>
            </div>
          </aside>

          <section className={s.center}>
            <GlobeView />
            <TimelineBar />

            <button
              type="button"
              className={`${s.edge} ${s.edgeLeft}`}
              onClick={() => setLeftOpen(false)}
              title="Свернуть панель параметров · ["
              aria-label="Свернуть панель параметров"
            >
              <IconChevronLeft size={13} />
            </button>
            <button
              type="button"
              className={`${s.edge} ${s.edgeRight}`}
              onClick={() => setRightOpen(false)}
              title="Свернуть панель показателей · ]"
              aria-label="Свернуть панель показателей"
            >
              <IconChevronRight size={13} />
            </button>
          </section>

          <aside
            className={`${s.aside} ${s.right}`}
            data-collapsed={rightOpen ? undefined : ''}
          >
            <div className={s.asideBody} inert={!rightOpen}>
              <Tabs
                value={rightTab}
                onChange={setRightTab}
                classNames={{ root: s.tabs, panel: s.tabPanel }}
              >
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
            </div>

            <div className={s.rail}>
              <button
                type="button"
                className={s.railBtn}
                onClick={() => openRight('metrics')}
                title="Показатели · ]"
              >
                <IconChartBar size={17} />
                <span className={s.railLabel}>Показатели</span>
              </button>
              <button
                type="button"
                className={s.railBtn}
                onClick={() => openRight('inspect')}
                title="Маршрут · ]"
              >
                <IconRoute size={17} />
                <span className={s.railLabel}>Маршрут</span>
              </button>
            </div>
          </aside>
        </main>
      )}
    </div>
  )
}
