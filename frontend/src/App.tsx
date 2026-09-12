import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Menu, Progress, Select, Tabs } from '@mantine/core'
import { useHotkeys } from '@mantine/hooks'
import {
  IconChartBar,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconColumns2,
  IconFileImport,
  IconRoute,
  IconSettings,
  IconUpload,
} from '@tabler/icons-react'
import { GlobeView } from './components/GlobeView'
import { TimelineBar } from './components/TimelineBar'
import { ConfigPanel } from './components/ConfigPanel'
import { MetricsPanel } from './components/MetricsPanel'
import { InspectorPanel } from './components/InspectorPanel'
import { VariantsPanel } from './components/VariantsPanel'
import { CompareModal } from './components/CompareModal'
import { RecomputeBar } from './components/RecomputeBar'
import { useProject } from './stores/project'
import type { ScenarioListItem } from './types/api'
import s from './App.module.css'

/** «01 · Полная группировка» — номер из id, чтобы порядок читался без сортировки. */
function optionLabel(item: ScenarioListItem) {
  const number = item.id.match(/^\d+/)?.[0]
  return number ? `${number} · ${item.title}` : item.title
}

/** Чем этот сценарий отличается от соседнего — видно до его загрузки. */
function optionHint(item: ScenarioListItem) {
  const parts: string[] = []
  if (item.launch_stage != null) parts.push(`очередь ${item.launch_stage}`)
  if (item.isl_range_km != null) parts.push(`ISL ${item.isl_range_km} км`)
  if (item.n_failures) parts.push(`отказов: ${item.n_failures}`)
  return parts.join(' · ')
}

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
  const loadBuiltin = useProject((x) => x.loadBuiltin)
  const builtins = useProject((x) => x.builtins)
  const loadBuiltins = useProject((x) => x.loadBuiltins)
  const loadFile = useProject((x) => x.loadFile)
  const variants = useProject((x) => x.variants)
  const openCompare = useProject((x) => x.openCompare)

  // Сценарий не подставляется сам: пока пользователь не выбрал файл,
  // считать нечего. Расчёт запускается загрузкой, как описывает кейс.
  const fileInput = useRef<HTMLInputElement>(null)

  const [leftOpen, setLeftOpen] = useStickyFlag('ui.panel.left', true)
  const [rightOpen, setRightOpen] = useStickyFlag('ui.panel.right', true)
  const [rightTab, setRightTab] = useState<string | null>('metrics')

  useHotkeys([
    ['[', () => setLeftOpen((v) => !v)],
    [']', () => setRightOpen((v) => !v)],
    // сравнение — основной сценарий кейса, поэтому у него свой шорткат
    ['c', () => variants.length >= 2 && openCompare()],
  ])

  /** Клик по иконке свёрнутой правой панели открывает сразу нужную вкладку. */
  function openRight(tab: string) {
    setRightTab(tab)
    setRightOpen(true)
  }

  // Набор кейса тянем один раз: он не меняется в течение сессии.
  useEffect(() => {
    void loadBuiltins()
  }, [loadBuiltins])

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) void loadFile(f)
    e.target.value = ''
  }

  function pickBuiltin(v: string | null) {
    if (!v) return
    void loadBuiltin(v)
  }

  /**
   * Какой из сценариев набора открыт сейчас — берём из самого сценария,
   * а не из отдельного состояния выбора: после загрузки своего файла
   * отдельное состояние рассинхронизировалось бы с тем, что на экране.
   */
  const builtinId = scenario && builtins.some((b) => b.id === scenario.meta.id)
    ? scenario.meta.id
    : null
  const isCustom = Boolean(scenario) && builtinId === null


  return (
    <div className={s.app}>
      <header className={s.header}>
        <div className={s.brand}>
          <span className={s.logo}>◎</span>
          <div>
            <h1>Проектирование спутниковой группировки</h1>
          </div>
        </div>

        {/*
          Один источник проекта вместо двух контролов.
          Раньше рядом стояли список сценариев набора и кнопка «Загрузить JSON»,
          и связь между ними была неочевидна: непонятно, это две разные вещи или
          одна. Теперь это одно меню «откуда взят проект», где набор кейса и свой
          файл — пункты одного выбора, а в кнопке видно текущий ответ.

          Пока проект не загружен, меню не показываем: тот же выбор уже стоит
          в центре стартового экрана двумя большими кнопками.
        */}
        <div className={s.actions}>
          {scenario && (
            <Menu shadow="md" width={278} position="bottom-end" withinPortal>
              <Menu.Target>
                <Button
                  variant="default"
                  leftSection={<IconFileImport size={15} />}
                  rightSection={<IconChevronDown size={14} />}
                  className={s.source}
                >
                  {scenario.meta.title}
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Из набора кейса</Menu.Label>
                {builtins.map((b) => (
                  <Menu.Item
                    key={b.id}
                    leftSection={
                      builtinId === b.id ? (
                        <IconCheck size={14} />
                      ) : (
                        <span className={s.checkGap} />
                      )
                    }
                    onClick={() => pickBuiltin(b.id)}
                  >
                    {optionLabel(b)}
                    <span className={s.optionHint}>{optionHint(b)}</span>
                  </Menu.Item>
                ))}

                <Menu.Divider />

                {isCustom && (
                  <>
                    <Menu.Label>Загруженный файл</Menu.Label>
                    <Menu.Item leftSection={<IconCheck size={14} />} disabled>
                      {scenario.meta.title}
                    </Menu.Item>
                  </>
                )}
                <Menu.Item
                  leftSection={<IconUpload size={14} />}
                  onClick={() => fileInput.current?.click()}
                >
                  Загрузить свой JSON…
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}

          {/* Скрытое поле нужно и стартовому экрану, поэтому вне условия. */}
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={onFile}
          />
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
              data={builtins.map((b) => ({ value: b.id, label: optionLabel(b) }))}
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
                  <Tabs.Tab
                    value="variants"
                    rightSection={
                      variants.length ? <span className={s.count}>{variants.length}</span> : null
                    }
                  >
                    Варианты
                  </Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel value="metrics">
                  <MetricsPanel />
                </Tabs.Panel>
                <Tabs.Panel value="inspect">
                  <InspectorPanel onPickClient={() => setRightTab('metrics')} />
                </Tabs.Panel>
                <Tabs.Panel value="variants">
                  <VariantsPanel />
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
              <button
                type="button"
                className={s.railBtn}
                onClick={() => openRight('variants')}
                title="Варианты · ]"
              >
                <IconColumns2 size={17} />
                <span className={s.railLabel}>Варианты</span>
              </button>
            </div>
          </aside>
        </main>
      )}

      <CompareModal />
    </div>
  )
}
