/**
 * Вкладка «Варианты»: карточки сохранённых конфигураций.
 *
 * Это витрина, а не аналитика. Задача панели — дать увидеть, что вариантов
 * стало пять, чем третий отличается от базы и какой из них пока лучший,
 * а затем отправить инженера в окно сравнения. Всё, что требует ширины
 * (таблицы, графики, полосы на одной сетке), живёт там.
 */

import { useMemo, useRef, useState } from 'react'
import { ActionIcon, Badge, Button, Checkbox, TextInput, Tooltip } from '@mantine/core'
import {
  IconCheck,
  IconColumns2,
  IconCrosshair,
  IconDownload,
  IconHistory,
  IconPencil,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react'
import { useProject } from '../stores/project'
import { diffChips, pickBest, viewOf } from '../lib/compare'
import { fmtDurShort } from '../lib/viz'
import { downloadVariantResult } from '../lib/resultExport'
import s from './VariantsPanel.module.css'

export function VariantsPanel() {
  const variants = useProject((x) => x.variants)
  const compareIds = useProject((x) => x.compareIds)
  const baseVariantId = useProject((x) => x.baseVariantId)
  const restoreVariant = useProject((x) => x.restoreVariant)
  const removeVariant = useProject((x) => x.removeVariant)
  const renameVariant = useProject((x) => x.renameVariant)
  const toggleCompare = useProject((x) => x.toggleCompare)
  const setBaseVariant = useProject((x) => x.setBaseVariant)
  const openCompare = useProject((x) => x.openCompare)
  const loadFile = useProject((x) => x.loadFile)
  const busy = useProject((x) => x.busy)

  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  /**
   * Файл сразу становится сохранённым вариантом и попадает в сравнение.
   * Иначе путь «сравнить с чужим сценарием» шёл через меню в шапке и
   * ручное сохранение на другой вкладке — пять шагов вместо двух.
   */
  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file) void loadFile(file, { asVariant: true })
  }

  const views = useMemo(() => variants.map(viewOf), [variants])
  const base = views.find((v) => v.id === baseVariantId) ?? views[0] ?? null

  /**
   * Лучший вариант максимизирует результат самого слабого пункта: высокий
   * процент у двух пунктов не должен прятать провал у третьего.
   */
  const bestId = useMemo(() => (views.length < 2 ? null : pickBest(views).id), [views])

  const selected = compareIds.filter((id) => variants.some((v) => v.id === id))

  function commitRename(id: string) {
    if (draft.trim()) renameVariant(id, draft)
    setEditing(null)
  }

  return (
    <div className={s.panel}>
      {!variants.length ? (
        <div className={s.empty}>
          <IconColumns2 size={26} />
          <p>
            Сохранённых вариантов пока нет. Сохраните текущий результат на вкладке
            «Показатели», затем измените конфигурацию и пересчитайте её.
          </p>
          <p className={s.hint}>
            Для сравнения нужны минимум два варианта.
          </p>
          <Button
            size="xs"
            variant="default"
            loading={busy}
            leftSection={<IconUpload size={14} />}
            onClick={() => fileInput.current?.click()}
          >
            Добавить вариант из файла
          </Button>
        </div>
      ) : (
        <>
          <ul className={s.list}>
            {views.map((v) => {
              const chips = base ? diffChips(base, v, 2) : []
              const isBase = v.id === base?.id
              const delta = base ? v.agg.worstAvailability - base.agg.worstAvailability : 0
              return (
                <li
                  key={v.id}
                  className={s.card}
                  data-checked={selected.includes(v.id) || undefined}
                >
                  <Checkbox
                    size="xs"
                    checked={selected.includes(v.id)}
                    onChange={() => toggleCompare(v.id)}
                    aria-label={`включить «${v.label}» в сравнение`}
                    className={s.check}
                  />

                  <div className={s.body}>
                    <div className={s.titleRow}>
                      {editing === v.id ? (
                        <TextInput
                          size="xs"
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.currentTarget.value)}
                          onBlur={() => commitRename(v.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename(v.id)
                            if (e.key === 'Escape') setEditing(null)
                          }}
                          className={s.rename}
                        />
                      ) : (
                        <>
                          <strong>{v.label}</strong>
                          {isBase && (
                            <Badge size="xs" variant="light" color="gray">
                              база
                            </Badge>
                          )}
                          {bestId === v.id && (
                            <Badge size="xs" variant="light" color="green">
                              лучший
                            </Badge>
                          )}
                        </>
                      )}
                      <span className={s.score}>
                        {v.agg.worstAvailability.toFixed(2)}%
                      </span>
                    </div>

                    <p className={s.sub}>
                      минимум · {v.agg.worstClient}
                      {!isBase && (
                        <span className={delta >= 0 ? s.deltaUp : s.deltaDown}>
                          {delta > 0 ? '+' : delta < 0 ? '−' : ''}{Math.abs(delta).toFixed(2)} п.п.
                        </span>
                      )}
                    </p>

                    <span className={s.meter}>
                      <span style={{ width: `${v.agg.worstAvailability}%` }} />
                    </span>

                    {chips.length > 0 && (
                      <div className={s.chips}>
                        {chips.map((c) => (
                          <span key={c} className={s.chip}>
                            {c}
                          </span>
                        ))}
                      </div>
                    )}

                    <p className={s.sub}>макс. перерыв {fmtDurShort(v.agg.maxGapS)} · аппаратов {v.agg.activeSats}</p>
                  </div>

                  <div className={s.actions}>
                    <Tooltip label="выгрузить результат по формату кейса" withArrow openDelay={400}>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="sky"
                        leftSection={<IconDownload size={13} />}
                        className={s.exportButton}
                        onClick={() => downloadVariantResult(v)}
                      >
                        JSON
                      </Button>
                    </Tooltip>
                    <Tooltip label="сделать базой сравнения" withArrow openDelay={400}>
                      <ActionIcon
                        variant={isBase ? 'light' : 'subtle'}
                        color={isBase ? 'sky' : 'gray'}
                        radius="xl"
                        onClick={() => setBaseVariant(v.id)}
                      >
                        <IconCrosshair size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="переименовать" withArrow openDelay={400}>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        radius="xl"
                        onClick={() => {
                          setEditing(v.id)
                          setDraft(v.label)
                        }}
                      >
                        <IconPencil size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="вернуть эту конфигурацию" withArrow openDelay={400}>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        radius="xl"
                        onClick={() => restoreVariant(v.id)}
                      >
                        <IconHistory size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="удалить вариант" withArrow openDelay={400}>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        radius="xl"
                        onClick={() => removeVariant(v.id)}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </div>
                </li>
              )
            })}
          </ul>

          <div className={s.footer}>
            <Button
              fullWidth
              leftSection={
                selected.length >= 2 ? <IconColumns2 size={14} /> : <IconCheck size={14} />
              }
              disabled={selected.length < 2}
              onClick={() => openCompare(selected)}
            >
              {variants.length < 2
                ? 'Нужен второй вариант'
                : selected.length < 2
                  ? 'Отметьте два варианта'
                  : `Сравнить (${selected.length})`}
            </Button>
            <Button
              fullWidth
              size="xs"
              variant="default"
              loading={busy}
              className={s.loadButton}
              leftSection={<IconUpload size={14} />}
              onClick={() => fileInput.current?.click()}
            >
              Добавить вариант из файла
            </Button>
            <p className={s.hint}>
              Принимается и сценарий кейса, и выгруженный результат
              (cosmo-A-result-1.0): он развернётся до сценария, стратегия
              маршрутизации восстановится.
            </p>
          </div>
        </>
      )}

      {/* один скрытый input на оба состояния панели */}
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={onPick}
      />
    </div>
  )
}
