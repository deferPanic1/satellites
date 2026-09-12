/**
 * Проигрывание временной шкалы.
 *
 * Время модельное и непрерывное: спутники двигаются плавно на 60 fps
 * (позиции считает orbital.ts). Состояние СЕТИ дискретно — оно меняется
 * только на отсчётах сетки 120 с, интерполировать его нельзя.
 * Поэтому здесь два значения: t (непрерывное) и stepIndex (дискретный).
 *
 * В React непрерывное время живёт ВНЕ стора, в мутируемом объекте
 * `playbackTime`: сцена Cesium читает его из своего requestAnimationFrame,
 * не трогая React вовсе. В стор время публикуется ~12 раз в секунду —
 * этого хватает часам и ползунку и не гонит рендер дерева на 60 fps.
 */

import { create } from 'zustand'

export const SPEEDS = [1, 10, 60, 120, 300, 600] as const

/** Непрерывное модельное время, секунды. Обновляется каждый кадр, минуя React. */
export const playbackTime = { t: 0 }

const PUBLISH_MS = 80

export interface PlaybackState {
  /** модельное время, опубликованное в React (~12 Гц) */
  t: number
  playing: boolean
  /** во сколько раз модельное время быстрее реального */
  speed: number
  horizonS: number
  stepS: number

  configure(horizon: number, step: number): void
  setSpeed(speed: number): void
  seek(seconds: number): void
  seekStep(index: number): void
  nudge(steps: number): void
  play(): void
  pause(): void
  toggle(): void
  reset(): void
}

let raf = 0
let lastFrame = 0
let lastPublish = 0

export const usePlayback = create<PlaybackState>((set, get) => ({
  t: 0,
  playing: false,
  speed: 60,
  horizonS: 86400,
  stepS: 120,

  configure(horizon, step) {
    set({ horizonS: horizon, stepS: step })
    if (playbackTime.t >= horizon) {
      playbackTime.t = 0
      set({ t: 0 })
    }
  },

  setSpeed(speed) {
    set({ speed })
  },

  seek(seconds) {
    const v = Math.max(0, Math.min(get().horizonS - 0.001, seconds))
    playbackTime.t = v
    set({ t: v })
  },

  seekStep(index) {
    get().seek(index * get().stepS)
  },

  nudge(steps) {
    const { stepS, horizonS } = get()
    const nSteps = Math.floor(horizonS / stepS)
    const current = Math.floor(playbackTime.t / stepS)
    get().seekStep(Math.max(0, Math.min(nSteps - 1, current + steps)))
  },

  play() {
    if (get().playing) return
    set({ playing: true })
    lastFrame = performance.now()
    lastPublish = lastFrame
    const tick = (now: number) => {
      if (!get().playing) return
      const dt = (now - lastFrame) / 1000
      lastFrame = now
      const { horizonS, speed } = get()
      const next = playbackTime.t + dt * speed
      // зациклить: за сутки картина повторяется не точно, но для демо удобно
      playbackTime.t = next >= horizonS ? 0 : next
      if (now - lastPublish >= PUBLISH_MS) {
        lastPublish = now
        set({ t: playbackTime.t })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
  },

  pause() {
    set({ playing: false, t: playbackTime.t })
    cancelAnimationFrame(raf)
  },

  toggle() {
    get().playing ? get().pause() : get().play()
  },

  reset() {
    get().pause()
    playbackTime.t = 0
    set({ t: 0 })
  },
}))

// ---- селекторы (возвращают примитивы — безопасны для useSyncExternalStore) ----

export const selectStepIndex = (s: PlaybackState) => Math.floor(s.t / s.stepS)
export const selectNSteps = (s: PlaybackState) => Math.floor(s.horizonS / s.stepS)
export const selectProgress = (s: PlaybackState) => (s.horizonS ? s.t / s.horizonS : 0)

export function formatClock(t: number): string {
  const total = Math.floor(t)
  const h = String(Math.floor(total / 3600)).padStart(2, '0')
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}
