import { Button } from '@mantine/core'
import { IconArrowBackUp, IconRefresh } from '@tabler/icons-react'
import { useProject } from '../stores/project'
import s from './RecomputeBar.module.css'

/**
 * Полоса «конфигурация изменена».
 *
 * Правка конфигурации не пересчитывает модель молча: она копится в черновике,
 * а пользователь видит список того, что изменил, и решает, когда считать.
 * Так каждый расчёт — осознанный шаг, и его результат есть с чем сравнить.
 */
export function RecomputeBar() {
  const pending = useProject((x) => x.pending)
  const stale = useProject((x) => x.stale)
  const busy = useProject((x) => x.busy)
  const run = useProject((x) => x.run)
  const revert = useProject((x) => x.revert)

  if (!stale) return null

  const changes = Object.values(pending)
  const word = plural(changes.length, 'правка', 'правки', 'правок')

  return (
    <div className={s.bar}>
      <div className={s.left}>
        <strong className={s.title}>
          Конфигурация изменена — {changes.length} {word}
        </strong>
        <div className={s.changes}>
          {changes.map((ch) => (
            <span key={ch.key} className={s.chip}>
              {ch.what}
              {ch.from !== undefined && ch.to !== undefined ? (
                <>
                  : <span className={s.mono}>{ch.from}</span> →{' '}
                  <span className={s.mono}>{ch.to}</span>
                </>
              ) : ch.to ? (
                <>
                  {' '}
                  <span className={s.mono}>{ch.to}</span>
                </>
              ) : null}
            </span>
          ))}
        </div>
      </div>

      <div className={s.actions}>
        <Button
          variant="subtle"
          color="gray"
          leftSection={<IconArrowBackUp size={14} />}
          onClick={revert}
        >
          Отменить
        </Button>
        <Button
          loading={busy}
          leftSection={<IconRefresh size={14} />}
          onClick={() => void run()}
        >
          Пересчитать
        </Button>
      </div>
    </div>
  )
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}
