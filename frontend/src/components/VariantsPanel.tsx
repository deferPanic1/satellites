/**
 * Вкладка «Варианты»: карточки сохранённых конфигураций.
 *
 * Это витрина, а не аналитика. Задача панели — дать увидеть, что вариантов
 * стало пять, чем третий отличается от базы и какой из них пока лучший,
 * а затем отправить инженера в окно сравнения. Всё, что требует ширины
 * (таблицы, графики, полосы на одной сетке), живёт там.
 */

import { useMemo, useState } from 'react'
import { ActionIcon, Badge, Button, Checkbox, TextInput, Tooltip } from '@mantine/core'
import {
  IconBookmark,
  IconCheck,
  IconColumns2,
  IconCrosshair,
  IconHistory,
  IconPencil,
  IconTrash,
} from '@tabler/icons-react'
import { describeScenario, useProject } from '../stores/project'
import { diffChips, viewOf } from '../lib/compare'
import { fmtDurShort, variantColor } from '../lib/viz'
import s from './VariantsPanel.module.css'

export function VariantsPanel() {
  const variants = useProject((x) => x.variants)
  const result = useProject((x) => x.result)
  const stale = useProject((x) => x.stale)
  const compareIds = useProject((x) => x.compareIds)
  const baseVariantId = useProject((x) => x.baseVariantId)
  const saveVariant = useProject((x) => x.saveVariant)
  const restoreVariant = useProject((x) => x.restoreVariant)
  const removeVariant = useProject((x) => x.removeVariant)
  const renameVariant = useProject((x) => x.renameVariant)
  const toggleCompare = useProject((x) => x.toggleCompare)
  const setBaseVariant = useProject((x) => x.setBaseVariant)
  const openCompare = useProject((x) => x.openCompare)

  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const views = useMemo(() => variants.map(viewOf), [variants])
  const base = views.find((v) => v.id === baseVariantId) ?? views[0] ?? null

  /**
   * Лучший вариант максимизирует результат самого слабого пункта: высокий
   * процент у двух пунктов не должен прятать провал у третьего.
   */
  const bestId = useMemo(() => {
    if (views.length < 2) return null
    return views.reduce((a, v) => (v.agg.worstAvailability > a.agg.worstAvailability ? v : a)).id
  }, [views])

  const selected = compareIds.filter((id) => variants.some((v) => v.id === id))

  function commitRename(id: string) {
    if (draft.trim()) renameVariant(id, draft)
    setEditing(null)
  }

  return (
    <div className={s.panel}>
      <div className={s.top}>
        <Button
          fullWidth
          variant="outline"
          leftSection={<IconBookmark size={14} />}
          disabled={!result || stale}
          title={stale ? 'Сначала пересчитайте изменения или отмените их' : undefined}
          onClick={() => saveVariant()}
        >
          Сохранить текущий расчёт
        </Button>
        {stale && (
          <p className={s.hint}>
            Конфигурация изменена — сохранять нечего, пока результат не пересчитан.
          </p>
        )}
      </div>

      {!variants.length ? (
        <div className={s.empty}>
          <IconColumns2 size={26} />
          <p>
            Вариант — это конфигурация вместе с её расчётом. Сохраните текущий, поменяйте
            очередь запуска или фазирование плоскости, пересчитайте и сохраните второй.
          </p>
          <p className={s.hint}>
            Сравнение открывается от двух вариантов: доступность, перерывы, маршруты и дифф
            параметров на одной сетке времени.
          </p>
        </div>
      ) : (
        <>
          <ul className={s.list}>
            {views.map((v) => {
              const chips = base ? diffChips(base, v) : []
              const isBase = v.id === base?.id
              return (
                <li
                  key={v.id}
                  className={s.card}
                  style={{ ['--tint' as string]: variantColor(v.seq) }}
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
                      <span className={s.score}>{v.agg.worstAvailability.toFixed(2)} %</span>
                    </div>

                    <p className={s.sub}>{describeScenario(v.scenario)}</p>

                    {chips.length > 0 && (
                      <div className={s.chips}>
                        {chips.map((c) => (
                          <span key={c} className={s.chip}>
                            {c}
                          </span>
                        ))}
                      </div>
                    )}

                    <p className={s.sub}>
                      худший {v.agg.worstClient} · макс. перерыв {fmtDurShort(v.agg.maxGapS)} ·{' '}
                      {v.agg.avgHops.toFixed(2)} перехода
                    </p>
                  </div>

                  <div className={s.actions}>
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
            <p className={s.hint}>
              {variants.length < 2
                ? 'Поменяйте очередь запуска, фазирование или дальность ISL, пересчитайте и сохраните второй вариант.'
                : 'База — то, с чем считаются дельты. Отмеченные галочкой участвуют в сравнении. Горячая клавиша сравнения — C.'}
            </p>
          </div>
        </>
      )}
    </div>
  )
}
