# REVIT_MCP_study Upstream Audit

Generated: 2026-08-04T05:47:02.506Z

## Baseline

- Pinned commit: `cfe073951fa1e43792f9d93f015d7b82416df621`
- Vendored baseline valid: `true`
- Agent internal tools: `148`
- Agent-owned tools: `execute_dynamic_csharp`, `get_task_context`

## Audited Upstream

- Ref: `origin/main`
- Commit: `434606e178a186448921265e8fba909f74f4548b`
- Commit date: `2026-08-03T01:04:03Z`
- Runtime tool names: `167`
- Exact overlap with Agent catalog: `146`

## Upstream-only Tools (21)

- `analyze_tall_partition_rooms`
- `auto_convert_rotated_viewport_patterns`
- `auto_dimension_walls`
- `batch_create_rc_filled_region`
- `calculate_exterior_wall_scaffold_perimeter`
- `calculate_room_scaffold_perimeters`
- `calculate_selected_detail_line_perimeter`
- `check_sanitary_fixture_requirements`
- `convert_drafting_to_model_pattern`
- `create_curtain_wall_elevations`
- `create_rc_filled_region`
- `create_room_filled_regions`
- `diagnose_curtain_wall_elevation_direction`
- `diagnose_curtain_wall_elevation_directions`
- `duplicate_views_with_detailing`
- `get_room_door_counts`
- `get_room_window_counts`
- `remap_room_finish_codes`
- `renumber_rooms_by_level`
- `sync_ifc_structural_to_native`
- `sync_room_ceiling_finish_from_ceilings`

## Agent-only Tools (2)

- `execute_dynamic_csharp`
- `get_task_context`

> This is a name-level audit. Do not publish new catalog entries until the corresponding Revit runtime implementation passes build and smoke tests.
