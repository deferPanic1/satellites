import collections
import dataclasses
import enum


__all__ = ['parse_edges']


class VertexType(enum.Enum):
    satellite='satellite'
    gateway='gateway'
    client='client'


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


@dataclasses.dataclass
class ProcessedClient:
    id_client: str
    is_connected: bool
    min_hopes: int | None


def parse_edges(edges_with_distanse: list[tuple[str, str, float]]) -> list[ProcessedClient]:
    edges = [(Vertex(s1), Vertex(s2)) for s1, s2, dis in edges_with_distanse]
    d = edges2list_con(edges)

    vertexes = list(set(d.keys()))
    vertex2min_hops: dict[Vertex, int] = collections.defaultdict(lambda: -1)
    deque = collections.deque()
    for now_vertex in vertexes:
        if now_vertex.type_vertex == VertexType.gateway:
            deque.append((now_vertex, 0))

    while deque:
        vertex, hops = deque.popleft()
        print(vertex, hops)
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
            is_connected=hops != -1,
            min_hopes=None if hops == -1 else hops,
        )
        for vertex, hops in vertex2min_hops.items() if vertex.type_vertex
        if vertex.type_vertex == VertexType.client
    ]


if __name__ == '__main__':
    data = [
        ['S01', 'S02', 2700.4402373472476],    # ISL
        ['S01', 'S20', 2700.4402373472460],    # ISL
        ['G_MUR', 'S20', 1260.1933200301964],  # наземная линия
        ['C72', 'S02', 1690.7468031879637],    # наземная линия
    ]
    print(parse_edges(data))
