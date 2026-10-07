"""Erzeugt das Beispielmodell "EFH Satteldach" als IFC4-Datei.

Standalone CLI:  python make_example.py [--out PFAD]

The model is fully deterministic: GUIDs come from uuid5 over stable names and
the STEP header carries a fixed timestamp, so two runs produce byte-identical
files. That is what makes the drift test in tests/test_ifc_example.py possible.

Geometry: footprint 10.0 x 8.0 m, two storeys of 3.0 m, gable roof at 38 deg
with an east-west ridge. Pitch range (35-45 deg), ridge direction and the eaves
height limit (6.50 m) are DOCUMENTED project constraints (PROJECT.md,
memory/b-plan-traufhoehe.md). Everything else — wall/slab/roof thicknesses,
opening sizes, axis distances, frame depth, U-values, fire ratings — is an
[ASSUMED] plausible default for a demo house, flagged at its constant.
"""

from __future__ import annotations

import argparse
import contextlib
import itertools
import math
import sys
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import numpy as np

import ifcopenshell
import ifcopenshell.api.aggregate
import ifcopenshell.api.context
import ifcopenshell.api.feature
import ifcopenshell.api.geometry
import ifcopenshell.api.project
import ifcopenshell.api.pset
import ifcopenshell.api.root
import ifcopenshell.api.spatial
import ifcopenshell.api.unit
import ifcopenshell.guid

# --- fixed model parameters ------------------------------------------------
# Marked values are [ASSUMED] plausible defaults for a demo house; the review
# (67-03-REVIEW-TASK1.md M-6) asked for the flag at the constant itself.

LENGTH = 10.0          # footprint in x [m]
WIDTH = 8.0            # footprint in y [m]
STOREY_HEIGHT = 3.0    # [m]
EXT_THICKNESS = 0.365  # [m] [ASSUMED] KS 17,5 cm + WDVS would be 0.335 m per
                       # PROJECT.md; 0.365 m is the classic masonry demo value
INT_THICKNESS = 0.115  # [m] [ASSUMED]
SLAB_THICKNESS = 0.20  # [m] [ASSUMED]
ROOF_THICKNESS = 0.24  # [m] [ASSUMED]
# 38 deg and an east-west ridge come from the example project itself
# (PROJECT.md and memory/b-plan-traufhoehe.md: 35-45 deg allowed, ridge
# direction mandatory, eaves at most 6.50 m) — documented, NOT assumed.
# The south-facing pitch is the one the project's open question about PV needs.
ROOF_PITCH_DEG = 38.0
RIDGE_Y = WIDTH / 2.0
# [ASSUMED] demo fire rating so the example passes the app's own IDS
# (public/beispiel/musterprojekt.ids BRAND-01 requires FireRating on every
# IFCWALL). F30-B is the typical requirement for load-bearing walls of small
# residential buildings; replace with the real project's fire-protection plan.
WALL_FIRE_RATING = "F30"
# Window U-value: memory/bauherr-praeferenz-holzfenster.md fixes triple glazing
# (U_w ~ 0.8-1.1 W/m2K per the memory note), so 1.0 — the old 1.3 contradicted
# the project's own memory (review M-5). Door value stays [ASSUMED].
WINDOW_U_VALUE = 1.0   # [W/(m2K)] triple glazing, wood frame (project memory)
DOOR_U_VALUE = 1.8     # [W/(m2K)] [ASSUMED]

# uuid5 namespace — any fixed UUID works, this is the RFC 4122 DNS namespace.
GUID_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")
GUID_PREFIX = "bit-atelier:efh-satteldach:"

# A fixed header timestamp keeps the written file byte-stable across runs.
FIXED_TIMESTAMP = "2026-01-01T00:00:00"


def stable_guid(name: str) -> str:
    """Compressed IFC GUID derived from a stable element name."""
    return ifcopenshell.guid.compress(uuid.uuid5(GUID_NS, GUID_PREFIX + name).hex)


@contextlib.contextmanager
def deterministic_guids() -> Iterator[None]:
    """Makes ifcopenshell.guid.new() deterministic for the duration of the build.

    Elements get a GUID derived from their name (see ModelBuilder.create), but the
    relationship objects the api layer creates on the side — IfcRelAggregates,
    IfcRelVoidsElement, IfcRelDefinesByProperties and friends — would each get a
    random one. That alone makes every run produce a different file. The api
    modules all call ifcopenshell.guid.new() by module attribute, so replacing it
    here covers them; the build order is fixed, so the counter is stable.
    """
    original = ifcopenshell.guid.new
    counter = itertools.count()
    ifcopenshell.guid.new = lambda: stable_guid(f"rel:{next(counter)}")
    try:
        yield
    finally:
        ifcopenshell.guid.new = original


def matrix(x: float = 0.0, y: float = 0.0, z: float = 0.0,
           direction: tuple[float, float, float] = (1.0, 0.0, 0.0)) -> np.ndarray:
    """4x4 placement matrix: local +X along `direction`, +Z up, origin at (x,y,z)."""
    x_axis = np.array(direction, dtype=float)
    x_axis /= np.linalg.norm(x_axis)
    z_axis = np.array((0.0, 0.0, 1.0))
    y_axis = np.cross(z_axis, x_axis)
    m = np.eye(4)
    m[:3, 0] = x_axis
    m[:3, 1] = y_axis
    m[:3, 2] = z_axis
    m[:3, 3] = (x, y, z)
    return m


def matrix_axes(origin: tuple[float, float, float],
                x_axis: tuple[float, float, float],
                y_axis: tuple[float, float, float]) -> np.ndarray:
    """4x4 placement matrix from two explicit axes — for tilted elements.

    Local z comes out as x cross y, so pick y such that z points outwards.
    """
    x = np.array(x_axis, dtype=float)
    x /= np.linalg.norm(x)
    y = np.array(y_axis, dtype=float)
    y /= np.linalg.norm(y)
    z = np.cross(x, y)
    m = np.eye(4)
    m[:3, 0], m[:3, 1], m[:3, 2] = x, y, z
    m[:3, 3] = origin
    return m


class ModelBuilder:
    """Builds the EFH model step by step and collects the key figures."""

    def __init__(self) -> None:
        self.file = ifcopenshell.file(schema="IFC4")
        self.body: Any = None
        self.storeys: dict[str, Any] = {}
        self.walls: list[Any] = []
        self.wall_specs: dict[str, dict[str, float]] = {}
        self.wall_qtos: dict[str, Any] = {}          # name -> Qto_WallBaseQuantities (H-2)
        self.host_openings: dict[str, list[float]] = {}  # wall name -> opening areas [m2]
        self.slabs: list[Any] = []
        self.roof_slabs: list[Any] = []
        self.windows: list[Any] = []
        self.doors: list[Any] = []
        self.openings: list[Any] = []

    # -- infrastructure ----------------------------------------------------

    def create(self, ifc_class: str, name: str, predefined_type: str | None = None) -> Any:
        """root.create_entity plus the deterministic GUID for `name`."""
        element = ifcopenshell.api.root.create_entity(
            self.file, ifc_class=ifc_class, name=name, predefined_type=predefined_type
        )
        element.GlobalId = stable_guid(f"{ifc_class}:{name}")
        return element

    def build_project(self) -> None:
        f = self.file
        project = self.create("IfcProject", "EFH Satteldach")

        units = [
            ifcopenshell.api.unit.add_si_unit(f, unit_type="LENGTHUNIT"),
            ifcopenshell.api.unit.add_si_unit(f, unit_type="AREAUNIT"),
            ifcopenshell.api.unit.add_si_unit(f, unit_type="VOLUMEUNIT"),
            ifcopenshell.api.unit.add_si_unit(f, unit_type="PLANEANGLEUNIT"),
        ]
        ifcopenshell.api.unit.assign_unit(f, units=units)

        model = ifcopenshell.api.context.add_context(f, context_type="Model")
        self.body = ifcopenshell.api.context.add_context(
            f, context_type="Model", context_identifier="Body",
            target_view="MODEL_VIEW", parent=model,
        )

        site = self.create("IfcSite", "Grundstueck")
        building = self.create("IfcBuilding", "Einfamilienhaus")
        eg = self.create("IfcBuildingStorey", "EG")
        og = self.create("IfcBuildingStorey", "OG")
        eg.Elevation = 0.0
        og.Elevation = STOREY_HEIGHT
        self.storeys = {"EG": eg, "OG": og}

        ifcopenshell.api.aggregate.assign_object(f, products=[site], relating_object=project)
        ifcopenshell.api.aggregate.assign_object(f, products=[building], relating_object=site)
        ifcopenshell.api.aggregate.assign_object(f, products=[eg, og], relating_object=building)
        self.site, self.building = site, building

    # -- walls -------------------------------------------------------------

    def add_wall(self, name: str, storey: str, length: float, thickness: float,
                 x: float, y: float, direction: tuple[float, float, float],
                 is_external: bool) -> Any:
        f = self.file
        wall = self.create("IfcWall", name, predefined_type="SOLIDWALL")
        representation = ifcopenshell.api.geometry.add_wall_representation(
            f, context=self.body, length=length, height=STOREY_HEIGHT, thickness=thickness,
        )
        ifcopenshell.api.geometry.assign_representation(f, product=wall, representation=representation)
        z = self.storeys[storey].Elevation
        ifcopenshell.api.geometry.edit_object_placement(
            f, product=wall, matrix=matrix(x, y, z, direction),
        )
        ifcopenshell.api.spatial.assign_container(
            f, products=[wall], relating_structure=self.storeys[storey],
        )

        pset = ifcopenshell.api.pset.add_pset(f, product=wall, name="Pset_WallCommon")
        ifcopenshell.api.pset.edit_pset(f, pset=pset, properties={
            "IsExternal": is_external,
            "LoadBearing": is_external,
            # H-6 (67-03-REVIEW-TASK1): the app's own IDS (musterprojekt.ids
            # BRAND-01) requires FireRating on every IFCWALL — the reference
            # example must pass the house's own check suite. [ASSUMED] F30.
            "FireRating": WALL_FIRE_RATING,
        })
        pset.GlobalId = stable_guid(f"pset:{name}")

        gross_area = length * STOREY_HEIGHT
        qto = ifcopenshell.api.pset.add_qto(f, product=wall, name="Qto_WallBaseQuantities")
        ifcopenshell.api.pset.edit_qto(f, qto=qto, properties={
            "Length": round(length, 3),
            "Height": STOREY_HEIGHT,
            "Width": thickness,
            "GrossSideArea": round(gross_area, 3),
            # NetSideArea starts gross; deduct_openings() subtracts the hosted
            # windows/doors once they exist (H-2: IFC4 defines NetSideArea WITH
            # opening deduction — the old file carried the gross value).
            "NetSideArea": round(gross_area, 3),
            "GrossVolume": round(gross_area * thickness, 3),
            "NetVolume": round(gross_area * thickness, 3),
        })
        qto.GlobalId = stable_guid(f"qto:{name}")

        self.wall_specs[name] = {"length": length, "thickness": thickness}
        # Keep the Qto object: deduct_openings() rewrites NetSideArea/NetVolume
        # once the windows and doors exist (H-2).
        self.wall_qtos[name] = qto
        self.walls.append(wall)
        return wall

    def build_walls(self) -> None:
        """Four exterior walls plus two interior walls per storey = 12 walls."""
        for storey in ("EG", "OG"):
            # Exterior walls run along the outer face, clockwise from the south-west corner.
            self.add_wall(f"AW-Sued-{storey}", storey, LENGTH, EXT_THICKNESS,
                          0.0, 0.0, (1.0, 0.0, 0.0), True)
            self.add_wall(f"AW-Ost-{storey}", storey, WIDTH, EXT_THICKNESS,
                          LENGTH, 0.0, (0.0, 1.0, 0.0), True)
            self.add_wall(f"AW-Nord-{storey}", storey, LENGTH, EXT_THICKNESS,
                          LENGTH, WIDTH, (-1.0, 0.0, 0.0), True)
            self.add_wall(f"AW-West-{storey}", storey, WIDTH, EXT_THICKNESS,
                          0.0, WIDTH, (0.0, -1.0, 0.0), True)
            # Interior walls: one along x, one along y.
            self.add_wall(f"IW-Quer-{storey}", storey, LENGTH - 2 * EXT_THICKNESS,
                          INT_THICKNESS, EXT_THICKNESS, 4.0, (1.0, 0.0, 0.0), False)
            self.add_wall(f"IW-Laengs-{storey}", storey, 4.0 - EXT_THICKNESS,
                          INT_THICKNESS, 6.0, EXT_THICKNESS, (0.0, 1.0, 0.0), False)

    def build_storey_quantities(self) -> None:
        """BGF per storey as Qto_BuildingStoreyBaseQuantities.

        GrossFloorArea is the footprint. NetFloorArea subtracts the exterior
        wall thickness and the footprint of the interior walls of that storey.
        """
        f = self.file
        gross = LENGTH * WIDTH
        inner = (LENGTH - 2 * EXT_THICKNESS) * (WIDTH - 2 * EXT_THICKNESS)
        for key, storey in self.storeys.items():
            partitions = sum(
                spec["length"] * spec["thickness"]
                for name, spec in self.wall_specs.items()
                if name.startswith("IW-") and name.endswith(f"-{key}")
            )
            qto = ifcopenshell.api.pset.add_qto(
                f, product=storey, name="Qto_BuildingStoreyBaseQuantities",
            )
            ifcopenshell.api.pset.edit_qto(f, qto=qto, properties={
                "GrossFloorArea": round(gross, 3),
                "NetFloorArea": round(inner - partitions, 3),
                "GrossPerimeter": round(2 * (LENGTH + WIDTH), 3),
                "GrossHeight": STOREY_HEIGHT,
            })
            qto.GlobalId = stable_guid(f"qto:storey:{key}")

    # -- slabs -------------------------------------------------------------

    def add_slab(self, name: str, storey: str, z: float, predefined_type: str,
                 gross_area: float) -> Any:
        f = self.file
        slab = self.create("IfcSlab", name, predefined_type=predefined_type)
        polyline = [(0.0, 0.0), (LENGTH, 0.0), (LENGTH, WIDTH), (0.0, WIDTH)]
        representation = ifcopenshell.api.geometry.add_slab_representation(
            f, context=self.body, depth=SLAB_THICKNESS, polyline=polyline,
        )
        ifcopenshell.api.geometry.assign_representation(f, product=slab, representation=representation)
        ifcopenshell.api.geometry.edit_object_placement(f, product=slab, matrix=matrix(0.0, 0.0, z))
        ifcopenshell.api.spatial.assign_container(
            f, products=[slab], relating_structure=self.storeys[storey],
        )

        pset = ifcopenshell.api.pset.add_pset(f, product=slab, name="Pset_SlabCommon")
        ifcopenshell.api.pset.edit_pset(f, pset=pset, properties={
            "IsExternal": predefined_type != "FLOOR" or name.startswith("Bodenplatte"),
            "LoadBearing": True,
        })
        pset.GlobalId = stable_guid(f"pset:{name}")

        qto = ifcopenshell.api.pset.add_qto(f, product=slab, name="Qto_SlabBaseQuantities")
        ifcopenshell.api.pset.edit_qto(f, qto=qto, properties={
            # Schema: Width = "nominal width (or thickness)". H-3: the old file
            # carried the footprint edge (10.0 m) here; Length/Perimeter were
            # missing entirely. Depth keeps the short footprint edge.
            "Width": round(SLAB_THICKNESS, 3),
            "Length": round(LENGTH, 3),
            "Depth": round(WIDTH, 3),
            "Perimeter": round(2 * (LENGTH + WIDTH), 3),
            "GrossArea": round(gross_area, 3),
            "NetArea": round(gross_area, 3),
            "GrossVolume": round(gross_area * SLAB_THICKNESS, 3),
            "NetVolume": round(gross_area * SLAB_THICKNESS, 3),
        })
        qto.GlobalId = stable_guid(f"qto:{name}")

        self.slabs.append(slab)
        return slab

    def build_slabs(self) -> None:
        """Three horizontal slabs — the BGF per storey comes off these."""
        area = LENGTH * WIDTH  # 80.0 m2
        self.add_slab("Bodenplatte", "EG", -SLAB_THICKNESS, "BASESLAB", area)
        self.add_slab("Geschossdecke", "OG", STOREY_HEIGHT - SLAB_THICKNESS, "FLOOR", area)
        self.add_slab("Dachdecke", "OG", 2 * STOREY_HEIGHT - SLAB_THICKNESS, "FLOOR", area)

    # -- roof --------------------------------------------------------------

    def build_roof(self) -> None:
        """A gable roof: one IfcRoof aggregating two sloped IfcSlab panels.

        H-5 fix (67-03-REVIEW-TASK1): both panels used to end with their lower
        faces at the ridge, so the material above diverged and a 0.296 m wide,
        0.189 m deep notch ran the full 10 m ridge. Each panel is now extended
        up the slope by ROOF_THICKNESS * tan(pitch), which makes the UPPER
        faces meet exactly on the ridge axis (at ridge_z + t/cos(pitch)).
        The price is a small overlap wedge (~0.6 m3 over 10 m) at the ridge —
        the same class of accepted overlap as the wall corners (M-2), and how
        real roof surfaces are modelled when one rafter runs over the other.
        """
        f = self.file
        roof = self.create("IfcRoof", "Satteldach", predefined_type="GABLE_ROOF")
        ifcopenshell.api.spatial.assign_container(
            f, products=[roof], relating_structure=self.storeys["OG"],
        )
        ifcopenshell.api.geometry.edit_object_placement(
            f, product=roof, matrix=matrix(0.0, 0.0, 2 * STOREY_HEIGHT),
        )

        pitch = math.radians(ROOF_PITCH_DEG)
        rafter = RIDGE_Y / math.cos(pitch)   # true length along the slope
        # H-5: extension so the upper faces meet on the ridge axis (see above).
        ridge_ext = ROOF_THICKNESS * math.tan(pitch)
        panel_length = rafter + ridge_ext
        panel_area = panel_length * LENGTH
        eave_z = 2 * STOREY_HEIGHT

        # The panel itself stays a flat panel_length x LENGTH slab; the slope
        # comes from the placement, whose local x axis points up the pitch.
        # add_slab_representation's x_angle only tilts the extrusion direction,
        # not the surface, so it cannot produce a pitched roof.
        # Ridge runs east-west at y = RIDGE_Y, so the panels face south and north.
        cos_p, sin_p = math.cos(pitch), math.sin(pitch)
        for name, origin, x_axis, y_axis in (
            ("Dachflaeche-Sued", (LENGTH, 0.0, eave_z), (0.0, cos_p, sin_p), (-1.0, 0.0, 0.0)),
            ("Dachflaeche-Nord", (0.0, WIDTH, eave_z), (0.0, -cos_p, sin_p), (1.0, 0.0, 0.0)),
        ):
            panel = self.create("IfcSlab", name, predefined_type="ROOF")
            polyline = [(0.0, 0.0), (panel_length, 0.0), (panel_length, LENGTH), (0.0, LENGTH)]
            representation = ifcopenshell.api.geometry.add_slab_representation(
                f, context=self.body, depth=ROOF_THICKNESS, polyline=polyline,
            )
            ifcopenshell.api.geometry.assign_representation(
                f, product=panel, representation=representation,
            )
            ifcopenshell.api.geometry.edit_object_placement(
                f, product=panel, matrix=matrix_axes(origin, x_axis, y_axis),
            )
            ifcopenshell.api.aggregate.assign_object(f, products=[panel], relating_object=roof)

            pset = ifcopenshell.api.pset.add_pset(f, product=panel, name="Pset_SlabCommon")
            ifcopenshell.api.pset.edit_pset(f, pset=pset, properties={
                "IsExternal": True, "LoadBearing": True,
            })
            pset.GlobalId = stable_guid(f"pset:{name}")

            qto = ifcopenshell.api.pset.add_qto(f, product=panel, name="Qto_SlabBaseQuantities")
            ifcopenshell.api.pset.edit_qto(f, qto=qto, properties={
                # Width = nominal thickness per schema (H-3, same fix as the slabs).
                "Width": round(ROOF_THICKNESS, 3),
                "Length": round(panel_length, 3),
                "Depth": round(LENGTH, 3),
                "Perimeter": round(2 * (panel_length + LENGTH), 3),
                "GrossArea": round(panel_area, 3),
                "NetArea": round(panel_area, 3),
                "GrossVolume": round(panel_area * ROOF_THICKNESS, 3),
                "NetVolume": round(panel_area * ROOF_THICKNESS, 3),
            })
            qto.GlobalId = stable_guid(f"qto:{name}")

            self.roof_slabs.append(panel)

        # H-4: the roof aggregate itself carried neither a Pset nor a Qto.
        # Pset_RoofCommon (IsExternal, LoadBearing) and Qto_RoofBaseQuantities
        # sum the two panels; ProjectedArea is the footprint (10 x 8 m).
        roof_pset = ifcopenshell.api.pset.add_pset(f, product=roof, name="Pset_RoofCommon")
        ifcopenshell.api.pset.edit_pset(f, pset=roof_pset, properties={
            "IsExternal": True, "LoadBearing": True,
        })
        roof_pset.GlobalId = stable_guid("pset:Satteldach")
        roof_qto = ifcopenshell.api.pset.add_qto(f, product=roof, name="Qto_RoofBaseQuantities")
        ifcopenshell.api.pset.edit_qto(f, qto=roof_qto, properties={
            "GrossArea": round(2 * panel_area, 3),
            "NetArea": round(2 * panel_area, 3),
            "ProjectedArea": round(LENGTH * WIDTH, 3),
        })
        roof_qto.GlobalId = stable_guid("qto:Satteldach")

        self.roof = roof

    # -- openings ----------------------------------------------------------

    def add_opening(self, kind: str, name: str, host: Any, storey: str,
                    x: float, y: float, direction: tuple[float, float, float],
                    offset: float, sill: float, width: float, height: float) -> Any:
        """Cuts an opening into `host` and fills it with a window or a door.

        `offset` is the distance along the host wall, `sill` the height above
        the storey level. The opening is cut through the full wall thickness.
        """
        f = self.file
        thickness = EXT_THICKNESS
        z = self.storeys[storey].Elevation + sill

        # World position of the opening = wall origin + offset along the wall axis.
        dx, dy = direction[0], direction[1]
        ox, oy = x + dx * offset, y + dy * offset

        opening = self.create("IfcOpeningElement", f"Oeffnung-{name}", predefined_type="OPENING")
        # Cut right through the wall — 5 cm overshoot on both faces so the
        # boolean is clean instead of coplanar with the wall surface.
        void_rep = ifcopenshell.api.geometry.add_wall_representation(
            f, context=self.body, length=width, height=height,
            thickness=thickness + 0.10, offset=-0.05,
        )
        ifcopenshell.api.geometry.assign_representation(f, product=opening, representation=void_rep)
        ifcopenshell.api.geometry.edit_object_placement(
            f, product=opening, matrix=matrix(ox, oy, z, direction),
        )
        ifcopenshell.api.feature.add_feature(f, feature=opening, element=host)
        self.openings.append(opening)

        ifc_class = "IfcWindow" if kind == "window" else "IfcDoor"
        element = self.create(ifc_class, name)
        element.OverallHeight = height
        element.OverallWidth = width
        frame_depth = 0.06
        filling_rep = ifcopenshell.api.geometry.add_wall_representation(
            f, context=self.body, length=width, height=height,
            thickness=frame_depth, offset=(thickness - frame_depth) / 2,
        )
        ifcopenshell.api.geometry.assign_representation(f, product=element, representation=filling_rep)
        ifcopenshell.api.geometry.edit_object_placement(
            f, product=element, matrix=matrix(ox, oy, z, direction),
        )
        ifcopenshell.api.feature.add_filling(f, opening=opening, element=element)
        ifcopenshell.api.spatial.assign_container(
            f, products=[element], relating_structure=self.storeys[storey],
        )

        pset_name = "Pset_WindowCommon" if kind == "window" else "Pset_DoorCommon"
        pset = ifcopenshell.api.pset.add_pset(f, product=element, name=pset_name)
        ifcopenshell.api.pset.edit_pset(f, pset=pset, properties={
            "IsExternal": True,
            # M-5: the old window U-value (1.3) contradicted the project's own
            # memory (triple glazing, 0.8-1.1). Now named constants.
            "ThermalTransmittance": WINDOW_U_VALUE if kind == "window" else DOOR_U_VALUE,
        })
        pset.GlobalId = stable_guid(f"pset:{name}")

        # H-4: windows, doors and openings carried no quantities at all.
        # Qto names and property lists per ifcopenshell/util/schema/
        # ifc4_properties.json (Qto_WindowBaseQuantities: Area, Height,
        # Perimeter, Width; Qto_OpeningElementBaseQuantities: Area, Depth,
        # Height, Volume, Width).
        qto_name = ("Qto_WindowBaseQuantities" if kind == "window"
                    else "Qto_DoorBaseQuantities")
        qto = ifcopenshell.api.pset.add_qto(f, product=element, name=qto_name)
        ifcopenshell.api.pset.edit_qto(f, qto=qto, properties={
            "Width": round(width, 3),
            "Height": round(height, 3),
            "Perimeter": round(2 * (width + height), 3),
            "Area": round(width * height, 3),
        })
        qto.GlobalId = stable_guid(f"qto:{name}")

        opening_qto = ifcopenshell.api.pset.add_qto(
            f, product=opening, name="Qto_OpeningElementBaseQuantities",
        )
        ifcopenshell.api.pset.edit_qto(f, qto=opening_qto, properties={
            "Width": round(width, 3),
            "Height": round(height, 3),
            "Depth": round(thickness, 3),
            "Area": round(width * height, 3),
            "Volume": round(width * height * thickness, 3),
        })
        opening_qto.GlobalId = stable_guid(f"qto:Oeffnung-{name}")

        # Remember the opening size per host wall so deduct_openings() can
        # compute NetSideArea/NetVolume after all openings exist (H-2).
        host_key = host.Name
        area = width * height
        self.host_openings.setdefault(host_key, []).append(area)

        (self.windows if kind == "window" else self.doors).append(element)
        return element

    def deduct_openings(self) -> None:
        """Rewrites NetSideArea/NetVolume of every wall that hosts openings (H-2).

        IFC4 defines NetSideArea WITH opening deduction. Called after
        build_openings() so all windows/doors are known. The deduction is the
        rectangle width x height of each opening; the boolean cut is 5 cm
        deeper on each face, but the through-cut does not change the side area.
        """
        f = self.file
        for host_name, areas in self.host_openings.items():
            qto = self.wall_qtos.get(host_name)
            if qto is None:
                continue
            spec = self.wall_specs[host_name]
            length, thickness = spec["length"], spec["thickness"]
            gross_area = length * STOREY_HEIGHT
            opening_area = sum(areas)
            ifcopenshell.api.pset.edit_qto(f, qto=qto, properties={
                "NetSideArea": round(gross_area - opening_area, 3),
                "NetVolume": round((gross_area - opening_area) * thickness, 3),
            })

    def build_openings(self) -> None:
        """Six windows and two doors, all in exterior walls."""
        by_name = {w.Name: w for w in self.walls}

        # Three windows in the south wall of each storey.
        for storey in ("EG", "OG"):
            host = by_name[f"AW-Sued-{storey}"]
            for i, offset in enumerate((1.5, 4.5, 7.5), start=1):
                self.add_opening("window", f"Fenster-Sued-{storey}-{i}", host, storey,
                                 0.0, 0.0, (1.0, 0.0, 0.0), offset, 0.90, 1.26, 1.385)

        # Front door in the west wall of the ground floor.
        self.add_opening("door", "Haustuer", by_name["AW-West-EG"], "EG",
                         0.0, WIDTH, (0.0, -1.0, 0.0), 4.0, 0.0, 1.135, 2.135)
        # Terrace door in the north wall of the ground floor.
        self.add_opening("door", "Terrassentuer", by_name["AW-Nord-EG"], "EG",
                         LENGTH, WIDTH, (-1.0, 0.0, 0.0), 5.0, 0.0, 1.01, 2.135)

    # -- output ------------------------------------------------------------

    def normalize(self) -> None:
        """Sorts every relationship collection by GlobalId.

        The api layer gathers related objects in Python sets, whose iteration
        order depends on object identity — two runs would otherwise write the
        same elements in a different order and the file would never be
        byte-identical. Only relationship containers are touched; geometric
        lists (profile points, extrusion directions) keep their order.
        """
        f = self.file
        for rel in f.by_type("IfcRelationship"):
            for attr in ("RelatedElements", "RelatedObjects", "RelatedDefinitions",
                         "RelatedFeatureElement", "RelatedPropertySets"):
                value = getattr(rel, attr, None)
                if isinstance(value, tuple) and len(value) > 1:
                    if all(hasattr(v, "GlobalId") for v in value):
                        setattr(rel, attr, tuple(sorted(value, key=lambda e: e.GlobalId)))
        for assignment in f.by_type("IfcUnitAssignment"):
            assignment.Units = tuple(sorted(assignment.Units, key=lambda u: str(u)))

    def freeze_header(self, filename: str) -> None:
        """Fixed header values — without this every write would differ."""
        header = self.file.header
        header.file_name.name = filename
        header.file_name.time_stamp = FIXED_TIMESTAMP
        header.file_name.author = ("BIT-Atelier",)
        header.file_name.organization = ("BIT-Atelier",)
        header.file_name.preprocessor_version = "IfcOpenShell"
        header.file_name.originating_system = "BIT-Atelier Harness make_example.py"
        header.file_name.authorization = "None"
        header.file_description.description = (
            "ViewDefinition [ReferenceView_V1.2]",
        )

    def figures(self) -> dict[str, Any]:
        return {
            "walls": len(self.walls),
            "walls_external": sum(1 for w in self.walls if w.Name.startswith("AW-")),
            "slabs": len(self.slabs),
            "roof_slabs": len(self.roof_slabs),
            "windows": len(self.windows),
            "doors": len(self.doors),
            "openings": len(self.openings),
            "storeys": len(self.storeys),
            "bgf_per_storey": round(LENGTH * WIDTH, 3),
        }


def build(out_path: str | Path) -> dict[str, Any]:
    """Builds the model and writes it to `out_path`. Returns the key figures."""
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with deterministic_guids():
        builder = ModelBuilder()
        builder.build_project()
        builder.build_walls()
        builder.build_storey_quantities()
        builder.build_slabs()
        builder.build_roof()
        builder.build_openings()
        builder.deduct_openings()   # H-2: NetSideArea/NetVolume minus openings
        builder.normalize()
        builder.freeze_header(out_path.name)
        builder.file.write(str(out_path))

    figures = builder.figures()
    figures["path"] = str(out_path)
    return figures


def main(argv: list[str] | None = None) -> int:
    default_out = Path(__file__).resolve().parents[3] / "examples" / "efh-satteldach" / "model" / "efh.ifc"
    parser = argparse.ArgumentParser(
        description="Erzeugt das IFC-Beispielmodell 'EFH Satteldach' (deterministisch)."
    )
    parser.add_argument("--out", default=str(default_out),
                        help=f"Zieldatei (Standard: {default_out})")
    args = parser.parse_args(argv)

    figures = build(args.out)
    print(f"Geschrieben: {figures['path']}")
    print(f"  Geschosse:     {figures['storeys']}")
    print(f"  Waende:        {figures['walls']} "
          f"(davon {figures['walls_external']} Aussenwaende)")
    print(f"  Decken:        {figures['slabs']}")
    print(f"  Dachflaechen:  {figures['roof_slabs']}")
    print(f"  Fenster:       {figures['windows']}")
    print(f"  Tueren:        {figures['doors']}")
    print(f"  BGF/Geschoss:  {figures['bgf_per_storey']:.1f} m2")
    return 0


if __name__ == "__main__":
    sys.exit(main())
