/**
 * Императивная обёртка над CesiumJS.
 *
 * Это единственное место в проекте, где живёт Cesium. React сюда не заглядывает:
 * компонент GlobeView.tsx создаёт экземпляр в useEffect и дёргает update()
 * из кадрового цикла. Смешивать реактивность React с
 * императивным движком внутри одного слоя — верный способ получить утечки
 * и рассинхрон.
 *
 * Геометрическая оговорка: модель кейса считает Землю сферой R = 6371 км,
 * а Cesium рисует эллипсоид WGS84. Расхождение до ~21 км у полюсов, то есть
 * 0.3 % радиуса — визуально незаметно. Наземные пункты ставим средствами
 * Cesium (fromDegrees), спутники — по координатам нашей модели. Числовые
 * результаты берутся из SimulateResponse, а не из объектов Cesium.
 */

import * as Cesium from 'cesium'
import type { GroundSite, StepState } from '../types/api'
import { buildModel, positionsAt, type OrbitalModel } from './orbital'
import type { Scenario, Constants } from '../types/api'

const KM = 1000

const OVERVIEW = {
  lon: 60,
  lat: 55,
  heightM: 14_000_000,
}

const GROUND_FOCUS_HEIGHT_M = 9_000_000

const COLORS = {
  isl: Cesium.Color.fromCssColorString('#38bdf8').withAlpha(0.58),
  ground: Cesium.Color.fromCssColorString('#fbbf24').withAlpha(0.68),
  route: Cesium.Color.fromCssColorString('#4ade80'),
  satActive: Cesium.Color.fromCssColorString('#e2e8f0'),
  satInactive: Cesium.Color.fromCssColorString('#64748b'),
  satSelected: Cesium.Color.fromCssColorString('#f472b6'),
  satOnRoute: Cesium.Color.fromCssColorString('#4ade80'),
  client: Cesium.Color.fromCssColorString('#fbbf24'),
  gateway: Cesium.Color.fromCssColorString('#f87171'),
  orbit: Cesium.Color.fromCssColorString('#475569').withAlpha(0.5),
}

/**
 * Погашенные цвета сети. Пока конфигурация изменена, а расчёт не запущен,
 * рёбра и маршрут относятся к ПРЕЖНЕЙ конфигурации: геометрия уже новая,
 * сеть — ещё старая. Рисуем их еле заметно, чтобы не выдавать устаревшее
 * за действительное. Заведены константами: цвета выставляются каждый кадр
 * на ~80 полилиний, создавать их заново незачем.
 */
const STALE = {
  isl: COLORS.isl.withAlpha(0.08),
  ground: COLORS.ground.withAlpha(0.1),
  route: COLORS.route.withAlpha(0.18),
}

export interface SceneOptions {
  showRoute?: boolean
  showLabels?: boolean
  showOrbits?: boolean
  showIsl?: boolean
  showGroundLinks?: boolean
}

export interface UpdateArgs {
  /** модельное время, секунды от начала расчёта */
  t: number
  /** состояние сети на ближайшем отсчёте; null пока нет расчёта */
  step: StepState | null
  /** выбранный маршрут (последовательность ID) или null */
  route: string[] | null
  /** ID выбранного спутника */
  selectedSat: string | null
  /**
   * Неактивные аппараты, посчитанные фронтом из ЧЕРНОВИКА конфигурации.
   * Состав активных — чистая функция конфига (`launch_batch <= launch_stage`
   * и отсутствие отказа на момент t), поэтому он верен сразу после правки,
   * не дожидаясь расчёта. Если не передан, берётся из `step`.
   */
  inactive?: ReadonlySet<string>
  /** расчёт устарел: конфигурация изменена, сеть относится к прежней */
  stale?: boolean
  options: SceneOptions
}

export class ConstellationScene {
  private viewer: Cesium.Viewer
  private points: Cesium.PointPrimitiveCollection
  private labels: Cesium.LabelCollection
  private links: Cesium.PolylineCollection
  private orbits: Cesium.PolylineCollection
  private handler: Cesium.ScreenSpaceEventHandler

  private model: OrbitalModel | null = null
  private ground: GroundSite[] = []
  private groundCartesian = new Map<string, Cesium.Cartesian3>()
  private satIndex = new Map<string, number>()
  private buffer = new Float64Array(0)
  private cartesians: Cesium.Cartesian3[] = []
  private satClickCb: ((id: string | null) => void) | null = null

  constructor(container: HTMLElement) {
    this.viewer = new Cesium.Viewer(container, {
      // офлайн-подложка Natural Earth II из комплекта Cesium.
      // Никакого токена Cesium ion и никаких внешних CDN.
      baseLayer: Cesium.ImageryLayer.fromProviderAsync(
        Cesium.TileMapServiceImageryProvider.fromUrl(
          Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII'),
        ),
        {},
      ),
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: false,
    })

    const scene = this.viewer.scene
    scene.globe.enableLighting = false
    scene.globe.showGroundAtmosphere = true
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = true
    scene.backgroundColor = Cesium.Color.fromCssColorString('#05070d')
    // убираем кредит-баннер Cesium из поля зрения, но не удаляем (лицензия)
    const credit = this.viewer.cesiumWidget.creditContainer as HTMLElement
    credit.style.display = 'none'

    this.points = scene.primitives.add(new Cesium.PointPrimitiveCollection())
    this.labels = scene.primitives.add(new Cesium.LabelCollection())
    this.links = scene.primitives.add(new Cesium.PolylineCollection())
    this.orbits = scene.primitives.add(new Cesium.PolylineCollection())

    this.handler = new Cesium.ScreenSpaceEventHandler(scene.canvas)
    this.handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = scene.pick(e.position)
      const id = picked?.id
      this.satClickCb?.(typeof id === 'string' && this.satIndex.has(id) ? id : null)
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    // Viewer по умолчанию ставит на двойной клик слежение за Entity и
    // максимально приближает камеру. Для наземных пунктов это неожиданно:
    // пользователь теряет общий контекст, а камера остаётся привязанной к
    // выбранной точке. Навигацией управляем только своими явными действиями.
    this.viewer.screenSpaceEventHandler.removeInputAction(
      Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
    )

    this.resetView(false)
  }

  onSatelliteClick(cb: (id: string | null) => void) {
    this.satClickCb = cb
  }

  /** Пересобрать сцену под новый сценарий. Вызывать при смене конфигурации. */
  setScenario(scenario: Scenario, constants?: Constants) {
    this.model = buildModel(scenario, constants)
    this.ground = scenario.ground_sites
    this.satIndex = new Map(this.model.sats.map((s, i) => [s.id, i]))

    const n = this.model.sats.length
    this.buffer = new Float64Array(n * 3)
    this.cartesians = Array.from({ length: n }, () => new Cesium.Cartesian3())

    this.points.removeAll()
    this.labels.removeAll()
    this.links.removeAll()
    this.orbits.removeAll()
    this.viewer.entities.removeAll()
    this.groundCartesian.clear()

    for (const s of this.model.sats) {
      this.points.add({
        id: s.id,
        position: Cesium.Cartesian3.ZERO,
        pixelSize: 7,
        color: COLORS.satActive,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
        outlineWidth: 1,
      })
      this.labels.add({
        position: Cesium.Cartesian3.ZERO,
        text: s.id,
        font: '11px monospace',
        fillColor: Cesium.Color.WHITE.withAlpha(0.75),
        showBackground: false,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        show: false,
        scaleByDistance: new Cesium.NearFarScalar(6e6, 1.0, 4e7, 0.4),
      })
    }

    for (const g of scenario.ground_sites) {
      const pos = Cesium.Cartesian3.fromDegrees(g.lon_deg, g.lat_deg, 0)
      this.groundCartesian.set(g.id, pos)
      const isGw = g.role === 'gateway'
      this.viewer.entities.add({
        id: g.id,
        position: pos,
        point: {
          pixelSize: isGw ? 14 : 10,
          color: isGw ? COLORS.gateway : COLORS.client,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: g.id,
          font: 'bold 13px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -20),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
    }
  }

  /** Кадр анимации. Вызывается до 60 раз в секунду — без аллокаций. */
  update({ t, step, route, selectedSat, inactive: inactiveArg, stale, options }: UpdateArgs) {
    if (!this.model) return

    positionsAt(this.model, t, this.buffer)
    for (let i = 0; i < this.model.sats.length; i++) {
      Cesium.Cartesian3.fromElements(
        this.buffer[i * 3] * KM,
        this.buffer[i * 3 + 1] * KM,
        this.buffer[i * 3 + 2] * KM,
        this.cartesians[i],
      )
    }

    const inactive: ReadonlySet<string> =
      inactiveArg ?? (step ? new Set(step.inactive) : new Set<string>())
    // маршрут — результат расчёта; пока он устарел, аппараты по нему не подсвечиваем
    const onRoute = route && !stale && options.showRoute !== false ? new Set(route) : new Set<string>()

    for (let i = 0; i < this.points.length; i++) {
      const p = this.points.get(i)
      const id = p.id as string
      p.position = this.cartesians[i]
      if (id === selectedSat) {
        p.color = COLORS.satSelected
        p.pixelSize = 12
      } else if (onRoute.has(id)) {
        p.color = COLORS.satOnRoute
        p.pixelSize = 10
      } else if (inactive.has(id)) {
        p.color = COLORS.satInactive
        p.pixelSize = 5
      } else {
        p.color = COLORS.satActive
        p.pixelSize = 7
      }
      const lbl = this.labels.get(i)
      lbl.position = this.cartesians[i]
      lbl.show = !!options.showLabels
    }

    this.updateLinks(step, route, options, stale === true)
    if (options.showOrbits) this.updateOrbits(t)
    else if (this.orbits.length) this.orbits.removeAll()
  }

  private posOf(id: string): Cesium.Cartesian3 | undefined {
    const i = this.satIndex.get(id)
    if (i !== undefined) return this.cartesians[i]
    return this.groundCartesian.get(id)
  }

  /**
   * Пул полилиний: при 60 fps пересоздавать ~80 объектов каждый кадр —
   * это мусор для GC. Держим пул и переиспользуем.
   */
  private updateLinks(
    step: StepState | null,
    route: string[] | null,
    options: SceneOptions,
    stale: boolean,
  ) {
    let used = 0
    const ensure = (): Cesium.Polyline => {
      if (used < this.links.length) return this.links.get(used)
      return this.links.add({ positions: [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO] })
    }

    const routeEdges = new Set<string>()
    if (route && options.showRoute !== false) {
      for (let i = 0; i < route.length - 1; i++) {
        routeEdges.add(`${route[i]}|${route[i + 1]}`)
        routeEdges.add(`${route[i + 1]}|${route[i]}`)
      }
    }

    if (step) {
      for (const [a, b] of step.edges) {
        const isSatA = this.satIndex.has(a)
        const isSatB = this.satIndex.has(b)
        const isIsl = isSatA && isSatB
        if (isIsl && options.showIsl === false) continue
        if (!isIsl && options.showGroundLinks === false) continue
        if (routeEdges.has(`${a}|${b}`)) continue // маршрут рисуем отдельно, поверх

        const pa = this.posOf(a)
        const pb = this.posOf(b)
        if (!pa || !pb) continue

        const line = ensure()
        line.positions = [pa, pb]
        // Обычная сеть должна читаться на фоне Земли, но найденный маршрут
        // остаётся вдвое толще и полностью непрозрачным.
        line.width = 2
        line.material = Cesium.Material.fromType('Color', {
          color: isIsl ? (stale ? STALE.isl : COLORS.isl) : stale ? STALE.ground : COLORS.ground,
        })
        line.show = true
        used++
      }
    }

    if (route && route.length > 1 && options.showRoute !== false) {
      for (let i = 0; i < route.length - 1; i++) {
        const pa = this.posOf(route[i])
        const pb = this.posOf(route[i + 1])
        if (!pa || !pb) continue
        const line = ensure()
        line.positions = [pa, pb]
        line.width = stale ? 2 : 4
        line.material = Cesium.Material.fromType('Color', {
          color: stale ? STALE.route : COLORS.route,
        })
        line.show = true
        used++
      }
    }

    for (let i = used; i < this.links.length; i++) this.links.get(i).show = false
  }

  /** Кольца орбит: в земной системе они «уплывают», это физически верно. */
  private updateOrbits(t: number) {
    if (!this.model) return
    const planes = new Map<string, { raan: number }>()
    for (const s of this.model.sats) planes.set(s.planeId, { raan: s.raan })

    const SEGMENTS = 96
    const needed = planes.size
    while (this.orbits.length < needed) {
      this.orbits.add({ positions: [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO] })
    }

    const theta = this.model.theta0 + this.model.omega * t
    const cosT = Math.cos(theta)
    const sinT = Math.sin(theta)
    const cosInc = Math.cos(this.model.inc)
    const sinInc = Math.sin(this.model.inc)

    let k = 0
    for (const [, p] of planes) {
      const pts: Cesium.Cartesian3[] = []
      const co = Math.cos(p.raan)
      const so = Math.sin(p.raan)
      for (let j = 0; j <= SEGMENTS; j++) {
        const u = (j / SEGMENTS) * 2 * Math.PI
        const cu = Math.cos(u)
        const su = Math.sin(u)
        const xi = this.model.r * (co * cu - so * su * cosInc)
        const yi = this.model.r * (so * cu + co * su * cosInc)
        const zi = this.model.r * su * sinInc
        pts.push(
          Cesium.Cartesian3.fromElements(
            (xi * cosT + yi * sinT) * KM,
            (-xi * sinT + yi * cosT) * KM,
            zi * KM,
          ),
        )
      }
      const line = this.orbits.get(k++)
      line.positions = pts
      line.width = 1
      line.material = Cesium.Material.fromType('Color', { color: COLORS.orbit })
      line.show = true
    }
  }

  /** Навести камеру на наземный пункт. */
  flyToGround(id: string) {
    const site = this.ground.find((g) => g.id === id)
    if (!site) return

    this.viewer.trackedEntity = undefined
    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        site.lon_deg,
        site.lat_deg,
        GROUND_FOCUS_HEIGHT_M,
      ),
      // Явная ориентация вниз по местной вертикали удерживает Землю в центре,
      // независимо от того, под каким углом пользователь смотрел до перелёта.
      orientation: {
        heading: 0,
        pitch: -Cesium.Math.PI_OVER_TWO,
        roll: 0,
      },
      duration: 1.2,
    })
  }

  /** Вернуть устойчивый общий вид без привязки камеры к объекту. */
  resetView(animated = true) {
    this.viewer.trackedEntity = undefined
    const view = {
      destination: Cesium.Cartesian3.fromDegrees(OVERVIEW.lon, OVERVIEW.lat, OVERVIEW.heightM),
      orientation: {
        heading: 0,
        pitch: -Cesium.Math.PI_OVER_TWO,
        roll: 0,
      },
    }
    if (animated) this.viewer.camera.flyTo({ ...view, duration: 1.0 })
    else this.viewer.camera.setView(view)
  }

  resize() {
    this.viewer.resize()
  }

  destroy() {
    this.handler.destroy()
    if (!this.viewer.isDestroyed()) this.viewer.destroy()
  }
}
