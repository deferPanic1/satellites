import collections
import dataclasses
import enum


__all__ = ['parse_edges']


class VertexType(enum.Enum):
    satellite = 'satellite'
    gateway = 'gateway'
    client = 'client'


def vertex_id2vertex_type(vertex_id: str) -> VertexType:
    match vertex_id[0]:
        case 'S':
            return VertexType.satellite
        case 'G':
            return VertexType.gateway
        case 'C':
            return VertexType.client
        case _:
            raise ValueError('Unsupported type id')


class Vertex(str):
    @property
    def type_vertex(self) -> VertexType:
        return vertex_id2vertex_type(self)


def edges2list_con(
    edges: list[tuple[Vertex, Vertex]],
) -> dict[Vertex, list[Vertex]]:
    d = collections.defaultdict(list)
    for s1, s2 in edges:
        d[s1].append(s2)
        d[s2].append(s1)

    return d


@dataclasses.dataclass(frozen=True)
class ProcessedClient:
    id_client: str
    is_connected: bool
    min_hopes: int | None


def parse_edges(
    edges_with_distance: list[list[str, str, float]],
) -> list[ProcessedClient]:
    edges = [(Vertex(s1), Vertex(s2)) for s1, s2, _ in edges_with_distance]
    d = edges2list_con(edges)

    vertexes = list(set(d.keys()))
    vertex2min_hops: dict[Vertex, int] = collections.defaultdict(lambda: -1)
    deque: collections.deque[tuple[Vertex, int]] = collections.deque()
    for now_vertex in vertexes:
        if now_vertex.type_vertex == VertexType.gateway:
            deque.append((now_vertex, 0))

    while deque:
        vertex, hops = deque.popleft()
        if vertex in vertex2min_hops:
            continue
        elif vertex == VertexType.client:
            vertex2min_hops[vertex] = hops
            continue

        vertex2min_hops[vertex] = hops
        for next_vertex in d[vertex]:
            deque.append((next_vertex, hops + 1))

    return [
        ProcessedClient(
            id_client=str(vertex),
            is_connected=vertex2min_hops[vertex] != -1,
            min_hopes=(
                None
                if vertex2min_hops[vertex] == -1
                else vertex2min_hops[vertex]
            ),
        )
        for vertex in vertexes
        if vertex.type_vertex == VertexType.client
    ]


if __name__ == '__main__':
    tests: list[tuple] = [
        # Пример 1: Морские кабели (ISL) и наземные линии
        (
            [
                ['S01', 'S02', 2700.4402373472476],    # ISL
                ['S01', 'S20', 2700.4402373472460],    # ISL
                ['G_MUR', 'S20', 1260.1933200301964],  # наземная линия
                ['C72', 'S02', 1690.7468031879637],    # наземная линия
            ],
            [
                ProcessedClient('C72', True, 4),
            ],
        ),

        # Пример 2: Смешанный кластер с несколькими точками присутствия
        (
            [
                ['S05', 'S06', 1840.5523112890412],    # ISL
                ['S05', 'S07', 3210.8874451002231],    # ISL
                ['S06', 'S07', 2950.1178234417905],    # ISL
                ['G_LON', 'S05', 780.3341287495012],   # наземная линия
                ['G_FRA', 'S06', 1120.9986543210987],  # наземная линия
                ['C31', 'S07', 2450.6678901234567],    # наземная линия
                ['C45', 'S05', 1980.2233445566778],    # наземная линия
            ],
            [
                ProcessedClient('C31', True, 3),
                ProcessedClient('C45', True, 2),
            ],
        ),

        # Пример 3: Трансконтинентальные маршруты
        (
            [
                ['S10', 'S11', 4500.7788990011223],    # ISL
                ['S10', 'S12', 5100.3344556677889],    # ISL
                ['S11', 'S13', 3890.1122334455667],    # ISL
                ['S12', 'S13', 2780.9988776655443],    # ISL
                ['G_NYC', 'S10', 890.5544332211001],   # наземная линия
                ['G_TYO', 'S11', 1340.6677889900112],  # наземная линия
                ['G_SYD', 'S12', 2100.4433221100998],  # наземная линия
                ['C88', 'S13', 1670.5566778899002],    # наземная линия
                ['C91', 'S11', 2450.1234567890123],    # наземная линия
            ],
            [
                ProcessedClient('C88', True, 3),
                ProcessedClient('C91', True, 2),
            ],
        ),

        # Пример 4: Плотная сеть с одной центральной точкой
        (
            [
                ['S30', 'S31', 1200.1112223334445],    # ISL
                ['S30', 'S32', 1350.4445556667778],    # ISL
                ['S30', 'S33', 980.7778889990001],     # ISL
                ['S30', 'S34', 1120.2223334445556],    # ISL
                ['G_AMS', 'S30', 450.6667778889990],   # наземная линия
                ['G_PAR', 'S31', 670.3334445556667],   # наземная линия
                ['G_ROM', 'S32', 890.1112223334445],   # наземная линия
                ['C12', 'S33', 1450.5556667778889],    # наземная линия
                ['C19', 'S34', 1780.8889990001112],    # наземная линия
            ],
            [
                ProcessedClient('C12', True, 3),
                ProcessedClient('C19', True, 3),
            ],
        ),

        # Пример 5: Резервные (backup) маршруты
        (
            [
                ['S50', 'S51', 3300.1234567890123],    # ISL
                ['S51', 'S52', 2100.9876543210987],    # ISL
                ['S50', 'S52', 4250.5555555555555],    # ISL (длинный путь)
                ['G_HKG', 'S50', 750.4444444444444],   # наземная линия
                ['G_SIN', 'S51', 980.3333333333333],   # наземная линия
                ['G_SEL', 'S52', 1620.2222222222222],  # наземная линия
                ['C03', 'S50', 1190.1111111111111],    # наземная линия
                ['C07', 'S52', 2050.0000000000000],    # наземная линия
            ],
            [
                ProcessedClient('C03', True, 2),
                ProcessedClient('C07', True, 2),
            ],
        ),

        # Пример 6: много успешно подключённых клиентов
        (
            [
                ['S60', 'S61', 100.0],   # ISL
                ['S61', 'S62', 100.0],   # ISL
                ['S60', 'S62', 150.0],   # ISL
                ['G_AAA', 'S60', 50.0],  # наземная линия
                ['G_BBB', 'S62', 60.0],  # наземная линия
                ['C01', 'S60', 20.0],    # наземная линия
                ['C02', 'S61', 30.0],    # наземная линия
                ['C03', 'S62', 40.0],    # наземная линия
                ['C04', 'S61', 25.0],    # наземная линия
                ['C05', 'S60', 15.0],    # наземная линия
                ['C06', 'S61', 35.0],    # наземная линия
            ],
            [
                ProcessedClient('C01', True, 2),
                ProcessedClient('C02', True, 3),
                ProcessedClient('C03', True, 2),
                ProcessedClient('C04', True, 3),
                ProcessedClient('C05', True, 2),
                ProcessedClient('C06', True, 3),
            ],
        ),

        # Пример 7: 0 успешно подключённых клиентов
        (
            [
                ['S70', 'S71', 100.0],   # ISL
                ['S71', 'S72', 100.0],   # ISL
                ['G_XXX', 'S99', 50.0],  # наземная линия
                ['C10', 'S70', 20.0],    # наземная линия
                ['C11', 'S71', 30.0],    # наземная линия
                ['C12', 'S72', 40.0],    # наземная линия
            ],
            [
                ProcessedClient('C10', False, None),
                ProcessedClient('C11', False, None),
                ProcessedClient('C12', False, None),
            ],
        ),
    ]
    for ind, (data, true_ans) in enumerate(tests, start=1):
        pred_ans = parse_edges(data)
        if set(pred_ans) == set(true_ans):
            continue

        print(
            f'Test {ind} - failed'
            f'\nPred ans: {pred_ans}'
            f'\nTrue ans: {true_ans}'
        )
        break
    else:
        print('Tests passed...')
