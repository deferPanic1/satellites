"""
Маршрутизация «клиент → шлюз» поверх рёбер одного снимка сети.

Правило кейса, которое здесь закреплено явно: наземные пункты не
ретранслируют трафик. Маршрут выходит из клиента, идёт только через
спутники и заканчивается на шлюзе. В geometry.py это сказано словами
(«ground nodes cannot relay traffic»), но сами рёбра там симметричны —
ограничение обязан накладывать тот, кто ищет путь.

Модуль написан заново, а не поверх processing_graph: там поиск шёл от
шлюзов, а путь восстанавливался перебором соседей и мог бросить
исключение на неоднозначности. Здесь обычный массив предков — маршрут
восстанавливается всегда и ровно тот, который нашли.
"""

from __future__ import annotations

import collections
import heapq
import math
import typing

OutageReason = typing.Literal['no_sat', 'isl_break', 'no_gw', 'gw_down']

#: Ребро снимка: два узла и расстояние между ними в километрах.
Edge = tuple[str, str, float]

MIN_HOPS = 'min_hops'
MIN_DISTANCE = 'min_distance'


class Graph:
    """Список смежности с весами. Порядок соседей сохраняет порядок рёбер."""

    __slots__ = ('_adj', '_weights')

    def __init__(self, edges: typing.Iterable[Edge]) -> None:
        self._adj: dict[str, list[tuple[str, float]]] = (
            collections.defaultdict(list)
        )
        self._weights: dict[tuple[str, str], float] = {}
        for left, right, distance_km in edges:
            self._adj[left].append((right, distance_km))
            self._adj[right].append((left, distance_km))
            self._weights[(left, right)] = distance_km
            self._weights[(right, left)] = distance_km

    def neighbours(self, node: str) -> list[tuple[str, float]]:
        return self._adj.get(node, [])

    def degree(self, node: str) -> int:
        return len(self._adj.get(node, ()))

    def distance(self, left: str, right: str) -> float:
        return self._weights[(left, right)]

    def path_km(self, path: typing.Sequence[str]) -> float:
        return sum(
            self.distance(path[i], path[i + 1])
            for i in range(len(path) - 1)
        )


def _restore(
    previous: dict[str, str],
    client_id: str,
    target: str | None,
) -> list[str]:
    if target is None:
        return []

    path = [target]
    while path[-1] != client_id:
        path.append(previous[path[-1]])

    path.reverse()
    return path


def _min_hops(
    graph: Graph,
    client_id: str,
    gateways: frozenset[str],
    ground_ids: frozenset[str],
) -> list[str]:
    """Поиск в ширину: минимум переходов."""
    previous: dict[str, str] = {}
    visited = {client_id}
    queue = collections.deque([client_id])
    target: str | None = None

    while queue:
        node = queue.popleft()
        if node in gateways:
            target = node
            break

        for next_node, _ in graph.neighbours(node):
            if next_node in visited:
                continue
            # через чужой наземный пункт трафик не пойдёт
            if next_node in ground_ids and next_node not in gateways:
                continue

            visited.add(next_node)
            previous[next_node] = node
            queue.append(next_node)

    return _restore(previous, client_id, target)


def _min_distance(
    graph: Graph,
    client_id: str,
    gateways: frozenset[str],
    ground_ids: frozenset[str],
) -> list[str]:
    """Дейкстра от клиента: минимум суммарной дальности."""
    previous: dict[str, str] = {}
    best: dict[str, float] = {client_id: 0.0}
    settled: set[str] = set()
    heap: list[tuple[float, str]] = [(0.0, client_id)]
    target: str | None = None

    while heap:
        distance_km, node = heapq.heappop(heap)
        if node in settled:
            continue
        if node in gateways:
            target = node
            break

        settled.add(node)
        for next_node, edge_km in graph.neighbours(node):
            if next_node in ground_ids and next_node not in gateways:
                continue

            candidate = distance_km + edge_km
            if candidate < best.get(next_node, math.inf):
                best[next_node] = candidate
                previous[next_node] = node
                heapq.heappush(heap, (candidate, next_node))

    return _restore(previous, client_id, target)


def find_route(
    graph: Graph,
    client_id: str,
    gateways: frozenset[str],
    ground_ids: frozenset[str],
    mode: str = MIN_HOPS,
) -> list[str]:
    """Маршрут от клиента до ближайшего шлюза. Пустой список — маршрута нет."""
    if mode == MIN_DISTANCE:
        return _min_distance(graph, client_id, gateways, ground_ids)

    return _min_hops(graph, client_id, gateways, ground_ids)


def classify_outage(
    graph: Graph,
    client_id: str,
    gateways: frozenset[str],
    offline_gateways: frozenset[str],
) -> OutageReason:
    """Почему маршрута нет. Порядок проверок задан кейсом: от частного к общему."""
    if not graph.degree(client_id):
        return 'no_sat'

    if gateways and all(
        gateway in offline_gateways for gateway in gateways
    ):
        return 'gw_down'

    if not any(graph.degree(gateway) for gateway in gateways):
        return 'no_gw'

    return 'isl_break'
