"""In-process plant knowledge graph (NetworkX) — asset / zone / spatial relations."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import networkx as nx

from app.core.config import get_settings

FLOOR_ORDER = {"ground": 0, "first": 1, "second": 2}
FLOOR_PLAN_PATH = Path(__file__).resolve().parent / "floor_plan_map.json"


def resolve_relation_for_focus(
    relation: str,
    *,
    focus_floor: str,
    other_floor: str,
) -> str:
    """Turn undirected vertical adjacency into NEAR | ABOVE | BELOW from focus."""
    if relation != "ABOVE":
        return relation
    focus_idx = FLOOR_ORDER.get(str(focus_floor), 0)
    other_idx = FLOOR_ORDER.get(str(other_floor), 0)
    if focus_idx == other_idx:
        return "NEAR"
    if focus_idx < other_idx:
        return "ABOVE"
    return "BELOW"


@dataclass(frozen=True)
class SpatialLink:
    """A proximity / vertical adjacency finding between two assets."""

    from_asset_id: str
    to_asset_id: str
    from_label: str
    to_label: str
    relation: str  # NEAR | ABOVE
    distance_m: float
    floors_apart: int
    reason: str


def _pixel_distance(a: dict[str, Any], b: dict[str, Any]) -> float:
    return math.hypot(float(a["x"]) - float(b["x"]), float(a["y"]) - float(b["y"]))


def load_floor_plan(path: Path | None = None) -> dict[str, Any]:
    p = path or FLOOR_PLAN_PATH
    with p.open(encoding="utf-8") as f:
        return json.load(f)


def build_knowledge_graph(
    floor_plan: dict[str, Any] | None = None,
    *,
    radius_m: float | None = None,
    scale_m_per_px: float | None = None,
    include_vertical: bool = True,
) -> nx.Graph:
    """
    Build an undirected plant KG:
      - asset nodes with x,y,floor,zone,label
      - zone nodes + LOCATED_IN
      - NEAR (same floor, within radius)
      - ABOVE (adjacent floors, within horizontal radius)
    """
    settings = get_settings()
    radius = radius_m if radius_m is not None else settings.agent_spatial_radius_m
    scale = (
        scale_m_per_px
        if scale_m_per_px is not None
        else settings.agent_scale_m_per_px
    )
    plan = floor_plan if floor_plan is not None else load_floor_plan()

    g: nx.Graph = nx.Graph()
    for asset_id, meta in plan.items():
        g.add_node(
            f"asset:{asset_id}",
            kind="asset",
            asset_id=asset_id,
            label=meta.get("label") or asset_id,
            zone=meta.get("zone"),
            floor=meta.get("floor") or "ground",
            x=float(meta["x"]),
            y=float(meta["y"]),
        )
        zone = meta.get("zone")
        if zone:
            znode = f"zone:{zone}"
            if znode not in g:
                g.add_node(znode, kind="zone", zone=zone)
            g.add_edge(f"asset:{asset_id}", znode, relation="LOCATED_IN")

    assets = [(n, d) for n, d in g.nodes(data=True) if d.get("kind") == "asset"]
    for i, (na, da) in enumerate(assets):
        for nb, db in assets[i + 1 :]:
            px = _pixel_distance(da, db)
            dist_m = px * scale
            fa = FLOOR_ORDER.get(str(da.get("floor")), 0)
            fb = FLOOR_ORDER.get(str(db.get("floor")), 0)
            floors_apart = abs(fa - fb)

            if floors_apart == 0 and dist_m <= radius:
                g.add_edge(
                    na,
                    nb,
                    relation="NEAR",
                    distance_m=round(dist_m, 2),
                    floors_apart=0,
                )
            elif include_vertical and floors_apart == 1 and dist_m <= radius:
                g.add_edge(
                    na,
                    nb,
                    relation="ABOVE",
                    distance_m=round(dist_m, 2),
                    floors_apart=1,
                    vertical=True,
                )
    return g


@lru_cache(maxsize=1)
def get_plant_graph() -> nx.Graph:
    return build_knowledge_graph()


def reset_plant_graph_cache() -> None:
    get_plant_graph.cache_clear()


def asset_node(asset_id: str) -> str:
    return f"asset:{asset_id}"


def neighbors_within_radius(
    g: nx.Graph,
    asset_id: str,
    *,
    radius_m: float | None = None,
) -> list[dict[str, Any]]:
    settings = get_settings()
    radius = radius_m if radius_m is not None else settings.agent_spatial_radius_m
    node = asset_node(asset_id)
    if node not in g:
        return []
    out: list[dict[str, Any]] = []
    for _, nbr, edata in g.edges(node, data=True):
        rel = edata.get("relation")
        if rel not in ("NEAR", "ABOVE"):
            continue
        dist = float(edata.get("distance_m") or 0.0)
        if dist > radius:
            continue
        nd = g.nodes[nbr]
        if nd.get("kind") != "asset":
            continue
        other_floor = str(nd.get("floor") or "ground")
        focus_floor = str(g.nodes[node].get("floor") or "ground")
        out.append(
            {
                "asset_id": nd["asset_id"],
                "label": nd.get("label"),
                "zone": nd.get("zone"),
                "floor": other_floor,
                "relation": resolve_relation_for_focus(
                    str(rel),
                    focus_floor=focus_floor,
                    other_floor=other_floor,
                ),
                "distance_m": dist,
                "floors_apart": int(edata.get("floors_apart") or 0),
            }
        )
    out.sort(key=lambda x: x["distance_m"])
    return out


def serialize_graph(g: nx.Graph | None = None) -> dict[str, Any]:
    graph = g if g is not None else get_plant_graph()
    nodes = [{"id": n, **{k: v for k, v in d.items()}} for n, d in graph.nodes(data=True)]
    edges = [
        {"source": u, "target": v, **dict(d)} for u, v, d in graph.edges(data=True)
    ]
    return {"nodes": nodes, "edges": edges}


def find_spatial_cooccurrences(
    *,
    focus_asset_id: str,
    gas_asset_ids: set[str],
    hot_work_asset_ids: set[str],
    g: nx.Graph | None = None,
    radius_m: float | None = None,
) -> list[SpatialLink]:
    """Detect hot-work within radius of a gas spike (incl. same-asset at 0m)."""
    graph = g if g is not None else get_plant_graph()
    settings = get_settings()
    radius = radius_m if radius_m is not None else settings.agent_spatial_radius_m
    links: list[SpatialLink] = []
    seen: set[tuple[str, str]] = set()

    def label_of(aid: str) -> str:
        n = asset_node(aid)
        if n in graph:
            return str(graph.nodes[n].get("label") or aid)
        return aid

    for gas_id in gas_asset_ids:
        if gas_id in hot_work_asset_ids:
            key = (gas_id, gas_id)
            if key not in seen:
                seen.add(key)
                links.append(
                    SpatialLink(
                        from_asset_id=gas_id,
                        to_asset_id=gas_id,
                        from_label=label_of(gas_id),
                        to_label=label_of(gas_id),
                        relation="NEAR",
                        distance_m=0.0,
                        floors_apart=0,
                        reason=(
                            "Hot work permit co-located with elevated gas "
                            "on the same asset"
                        ),
                    )
                )
        for nbr in neighbors_within_radius(graph, gas_id, radius_m=radius):
            other = nbr["asset_id"]
            if other not in hot_work_asset_ids:
                continue
            key = tuple(sorted((gas_id, other)))
            if key in seen:
                continue
            seen.add(key)
            gas_node = graph.nodes[asset_node(gas_id)]
            hot_node = graph.nodes[asset_node(other)]
            gas_floor = str(gas_node.get("floor") or "ground")
            hot_floor = str(hot_node.get("floor") or "ground")
            vertical = resolve_relation_for_focus(
                str(nbr["relation"]),
                focus_floor=hot_floor,
                other_floor=gas_floor,
            )
            links.append(
                SpatialLink(
                    from_asset_id=gas_id,
                    to_asset_id=other,
                    from_label=label_of(gas_id),
                    to_label=label_of(other),
                    relation=str(nbr["relation"]),
                    distance_m=float(nbr["distance_m"]),
                    floors_apart=int(nbr["floors_apart"]),
                    reason=(
                        f"Hot work at {label_of(other)} is {nbr['distance_m']:.1f}m "
                        f"from gas spike at {label_of(gas_id)} "
                        f"({vertical}, floors_apart={nbr['floors_apart']})"
                    ),
                )
            )

    if focus_asset_id in hot_work_asset_ids:
        for gas_id in gas_asset_ids:
            if gas_id == focus_asset_id:
                continue
            for nbr in neighbors_within_radius(
                graph, focus_asset_id, radius_m=radius
            ):
                if nbr["asset_id"] != gas_id:
                    continue
                key = tuple(sorted((gas_id, focus_asset_id)))
                if key in seen:
                    continue
                seen.add(key)
                focus_node = graph.nodes[asset_node(focus_asset_id)]
                gas_node = graph.nodes[asset_node(gas_id)]
                focus_floor = str(focus_node.get("floor") or "ground")
                gas_floor = str(gas_node.get("floor") or "ground")
                vertical = resolve_relation_for_focus(
                    str(nbr["relation"]),
                    focus_floor=focus_floor,
                    other_floor=gas_floor,
                )
                links.append(
                    SpatialLink(
                        from_asset_id=gas_id,
                        to_asset_id=focus_asset_id,
                        from_label=label_of(gas_id),
                        to_label=label_of(focus_asset_id),
                        relation=str(nbr["relation"]),
                        distance_m=float(nbr["distance_m"]),
                        floors_apart=int(nbr["floors_apart"]),
                        reason=(
                            f"Focus asset hot work within {nbr['distance_m']:.1f}m "
                            f"of gas at {label_of(gas_id)} ({vertical}, "
                            f"floors_apart={nbr['floors_apart']})"
                        ),
                    )
                )

    links.sort(key=lambda L: L.distance_m)
    return links
