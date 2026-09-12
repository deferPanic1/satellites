import collections
import dataclasses
import enum
import heapq

import msgspec

__all__ = ['get_min_hopes_stat', 'get_min_distance_stat']


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


def edges2adj_list(
    edges: list[tuple[Vertex, Vertex]],
) -> dict[Vertex, list[Vertex]]:
    d = collections.defaultdict(list)
    for s1, s2 in edges:
        d[s1].append(s2)
        d[s2].append(s1)

    return d


class ProcessedClient(msgspec.Struct):
    id_client: str
    is_connected: bool
    optimal_path: tuple[Vertex, ...] | None


@dataclasses.dataclass(frozen=True)
class HopesProcessedClient(ProcessedClient):
    min_hopes: int | None


@dataclasses.dataclass(frozen=True)
class DistanceProcessedClient(ProcessedClient):
    min_distance: float | None


EdgesWithDistance = tuple[str, str, float]


def restore_route(
    start_vertex: Vertex,
    adj_list: dict[Vertex, list[Vertex]],
    optimal_dis: dict[Vertex, float | int],
    distances: dict[Vertex, dict[Vertex, float | int]],
) -> list[Vertex]:
    optimal_path: list[Vertex] = [start_vertex]
    now_vertex = start_vertex
    while now_vertex.type_vertex != VertexType.gateway:
        min_next_vertex: Vertex | None = None
        for next_vertex in adj_list[now_vertex]:
            if (
                abs(
                    optimal_dis[next_vertex]
                    + distances[now_vertex][next_vertex]
                    - optimal_dis[now_vertex]
                ) > 10 ** -4
                or now_vertex == next_vertex
            ):
                continue

            min_next_vertex = next_vertex
            break

        if min_next_vertex is None:
            raise ValueError('"optimal_dis" has calculation errors.')

        now_vertex = min_next_vertex
        optimal_path.append(min_next_vertex)

    return optimal_path


def get_min_hopes_stat(
    edges_with_distance: list[EdgesWithDistance],
) -> list[HopesProcessedClient]:
    """
    Find paths with the minimum number of edges from
    each client to the gateway.
    """
    edges = [(Vertex(s1), Vertex(s2)) for s1, s2, _ in edges_with_distance]
    adj_list = edges2adj_list(edges)

    vertexes = list(set(adj_list.keys()))
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
        for next_vertex in adj_list[vertex]:
            deque.append((next_vertex, hops + 1))

    return [
        HopesProcessedClient(
            id_client=vertex,
            is_connected=vertex2min_hops[vertex] != -1,
            optimal_path=(
                None
                if vertex2min_hops[vertex] == -1
                else tuple(restore_route(
                    vertex,
                    adj_list,
                    vertex2min_hops,
                    collections.defaultdict(
                        lambda: collections.defaultdict(lambda: 1),
                    ),
                ))
            ),
            min_hopes=(
                None
                if vertex2min_hops[vertex] == -1
                else vertex2min_hops[vertex]
            ),
        )
        for vertex in vertexes
        if vertex.type_vertex == VertexType.client
    ]


def get_min_distance_stat(
    edges_with_distance: list[EdgesWithDistance],
) -> list[DistanceProcessedClient]:
    """
    Find the paths with the minimum total distance from
    each client to the gateway.
    """
    edges = [
        (Vertex(s1), Vertex(s2), distance)
        for s1, s2, distance in edges_with_distance
    ]
    distances: dict[Vertex, dict[Vertex, float]] = collections.defaultdict(
        lambda: collections.defaultdict(lambda: -1),
    )
    for v1, v2, now_dis in edges:
        distances[v1][v2] = now_dis
        distances[v2][v1] = now_dis

    adj_list = edges2adj_list([(v1, v2) for v1, v2, _ in edges])

    vertexes = list(set(adj_list.keys()))
    gateways = [
        vertex
        for vertex in vertexes
        if vertex.type_vertex == VertexType.gateway
    ]
    vertex2min_distance: dict[Vertex, float] = collections.defaultdict(
        lambda: -1,
    )
    for now_gateway in gateways:
        vertex2min_distance[now_gateway] = 0
        heap_edges: list[tuple[float, str, str]] = []
        for next_vertex in adj_list[now_gateway]:
            heap_edges.append((
                distances[now_gateway][next_vertex],
                now_gateway,
                next_vertex,
            ))

        was: set[Vertex] = {now_gateway}
        heapq.heapify(heap_edges)
        while heap_edges:
            dis, v1, v2 = heapq.heappop(heap_edges)
            if v2 in was:
                continue

            was.add(v2)
            if v2 in vertex2min_distance:
                vertex2min_distance[v2] = min(vertex2min_distance[v2], dis)
            else:
                vertex2min_distance[v2] = dis

            for next_vertex in adj_list[v2]:
                heapq.heappush(
                    heap_edges,
                    (dis + distances[v2][next_vertex], v2, next_vertex),
                )

    return [
        DistanceProcessedClient(
            id_client=vertex,
            is_connected=vertex2min_distance[vertex] != -1,
            optimal_path=(
                None
                if vertex2min_distance[vertex] == -1
                else tuple(restore_route(
                    vertex,
                    adj_list,
                    vertex2min_distance,
                    distances,
                ))
            ),
            min_distance=(
                None
                if vertex2min_distance[vertex] == -1
                else vertex2min_distance[vertex]
            ),
        )
        for vertex in vertexes
        if vertex.type_vertex == VertexType.client
    ]


if __name__ == '__main__':
    tests = [
        (
            [
                ('C01', 'S01', 10.0),
                ('S01', 'S02', 20.0),
                ('S02', 'G01', 30.0),
            ],
            {'C01': 3},
            {'C01': 60.0},
        ),
        (
            [
                ('C01', 'S01', 10.0),
                ('S01', 'S02', 100.0),
                ('S02', 'G01', 10.0),
                ('S01', 'S03', 20.0),
                ('S03', 'G01', 20.0),
            ],
            {'C01': 3},
            {'C01': 50.0},
        ),
        (
            [
                ('C01', 'S01', 10.0),
                ('S01', 'S02', 10.0),
                ('S02', 'G01', 10.0),
                ('S01', 'S03', 1.0),
                ('S03', 'S04', 1.0),
                ('S04', 'S05', 1.0),
                ('S05', 'G01', 1.0),
            ],
            {'C01': 3},
            {'C01': 14.0},
        ),
        (
            [
                ('C01', 'S01', 5.0),
                ('C02', 'S02', 7.0),
                ('S01', 'S02', 10.0),
                ('S01', 'G01', 20.0),
                ('S02', 'G01', 30.0),
            ],
            {
                'C01': 2,
                'C02': 2,
            },
            {
                'C01': 25.0,
                'C02': 37.0,
            },
        ),
        (
            [
                ('C01', 'S01', 10.0),
                ('S01', 'G01', 20.0),
                ('C02', 'S99', 10.0),
            ],
            {
                'C01': 2,
                'C02': None,
            },
            {
                'C01': 30.0,
                'C02': None,
            },
        ),

        # Два разных маршрута с одинаковым количеством hops.
        (
            [
                ('C01', 'S01', 10.0),
                ('S01', 'S02', 10.0),
                ('S02', 'G01', 10.0),

                ('S01', 'S03', 20.0),
                ('S03', 'G01', 20.0),
            ],
            {'C01': 3},
            {'C01': 30.0},
        ),

        # Два разных маршрута с одинаковой дистанцией.
        (
            [
                ('C01', 'S01', 10.0),
                ('S01', 'S02', 20.0),
                ('S02', 'G01', 30.0),

                ('S01', 'S03', 15.0),
                ('S03', 'G01', 45.0),
            ],
            {'C01': 3},
            {'C01': 60.0},
        ),
    ]

    for ind, (data, true_hopes, true_distance) in enumerate(
        tests,
        start=1,
    ):
        pred_hopes = get_min_hopes_stat(data)
        pred_distance = get_min_distance_stat(data)

        pred_hopes = {
            client.id_client: client.min_hopes
            for client in pred_hopes
        }
        pred_distance = {
            client.id_client: client.min_distance
            for client in pred_distance
        }

        if pred_hopes != true_hopes:
            print(
                f'Test {ind} - hops failed'
                f'\nPred ans: {pred_hopes}'
                f'\nTrue ans: {true_hopes}'
            )
            break

        if pred_distance != true_distance:
            print(
                f'Test {ind} - distance failed'
                f'\nPred ans: {pred_distance}'
                f'\nTrue ans: {true_distance}'
            )
            break

        print(f'Test {ind}: passed')
    else:
        print('Tests passed...')
