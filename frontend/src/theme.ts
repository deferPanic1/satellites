import { createTheme, type MantineColorsTuple } from '@mantine/core'

/**
 * Палитра повторяет прежнюю (Aura dark): рядом с чёрным космосом
 * светлая тема выглядит плохо, поэтому тёмная принудительно.
 */
const sky: MantineColorsTuple = [
  '#e0f4ff',
  '#cbe6f9',
  '#9acaf1',
  '#64ade9',
  '#3b95e2',
  '#2186de',
  '#0b7edd',
  '#006dc4',
  '#0061b0',
  '#00539b',
]

const dark: MantineColorsTuple = [
  '#e2e8f0',
  '#cbd5e1',
  '#94a3b8',
  '#64748b',
  '#475569',
  '#334155',
  '#131c2e',
  '#0b1220',
  '#070c16',
  '#05070d',
]

export const theme = createTheme({
  primaryColor: 'sky',
  primaryShade: { dark: 4 },
  colors: { sky, dark },
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSizes: { xs: '0.72rem', sm: '0.78rem', md: '0.85rem', lg: '1rem', xl: '1.15rem' },
  defaultRadius: 'sm',
  components: {
    Button: { defaultProps: { size: 'xs' } },
    Select: { defaultProps: { size: 'xs', comboboxProps: { withinPortal: true } } },
    NumberInput: { defaultProps: { size: 'xs' } },
    /**
     * Вертикальные линейки между сегментами отключены: плашка активного
     * пункта наезжала на них, соседняя линейка уходила под неё, и ряд
     * выглядел рваным — третий сегмент казался не отделённым от второго.
     * Выделение держится на плашке, вид — в styles/main.css.
     */
    SegmentedControl: { defaultProps: { size: 'xs', withItemsBorders: false } },
    Badge: { defaultProps: { size: 'sm', tt: 'none' } },
  },
})
