# Native family authoring

`builtin:create_family_file` and its lighting-template alias `builtin:create_lighting_family_file` share schema 2.0.3. They are direct-call experimental tools exposed through the existing six public Agent tools. Gateway authorization, destructive-action policy and Dynamic C# permissions are unchanged.

## Geometry contract

All geometry coordinates are millimetres. Each named part has `xMm`, `yMm`, `zMm` translation and integer RGB. Optional `rotateXDeg`, `rotateYDeg`, `rotateZDeg` rotate about the local origin in that order, using fixed family axes, before translation. These are native editable Revit forms, not mesh proxies.

| Kind | Shape inputs | Local geometry |
| --- | --- | --- |
| box | widthMm, depthMm, heightMm | XY centred rectangle, Z from 0 to height |
| cylinder | widthMm, depthMm, heightMm | width is diameter; depth retained for backwards compatibility; Z from 0 to height |
| profileExtrusion | profile, heightMm | XY loops extruded along +Z |
| revolution | profile, optional startAngleDeg/endAngleDeg | profile coordinates are radius/Z, rotation axis +Z; defaults 0/360 degrees |
| sweep | profile, path | XY profile, Revit automatic orientation at start of 3D path; profileLocationCurveIndex=0 |

`profile` is an array of closed loops, including holes. A loop is an array of curves with `start` and `end` 2D points. Optional `mid` supplies a third on-arc point for a circular arc; without it the curve is a line. A full circle uses two semicircular arcs. `path` uses the same curve representation with 3D points. Ordered curves must connect. Profiles must be closed, planar, non-self-intersecting and nonintersecting with other loops; Revit checks geometric validity during creation. The Bridge checks finite coordinates, point dimension, continuity, closure and degenerate arcs before creation. Invalid geometry rolls back and returns the Revit error without leaving an error dialog open.

`isVoid:true` requires explicit `cutTargets` naming solids in the same request. Solids cannot have cutTargets. Native solid forms are measured first, then designated cutters are switched to native voids and combined with their targets. A miss, an unintended intersection, deletion of all resulting geometry or disagreement between native cut volume and a separate Boolean result fails the transaction. Multiple cutters and multiple targets are supported through connected cut components. Do not model a recess as a solid insert of another colour.

Input limits are 64 parts, 16 loops per profile, 128 curves per loop/path, coordinates within +/-10,000mm, primitive lengths 1-10,000mm, and 32 text metadata fields. Limits bound request complexity; they do not select a fixture-specific modelling method. Safe ASCII names identify parts and files; metadata values can be Unicode. Inputs do not accept code or arbitrary output paths.

## Save-copy and verification

Use an installed English template filename (`templateName`) or an absolute RFA `sourcePath`, never both. A source is copied before opening. Only explicitly named BPA-authored parts are replaced. Native cut components must be included together when replacing them; source constraints or unrelated dependent forms are not deleted. Other source solids/combinations are measured and checked unchanged. New voids cannot cut unrequested source content.

Each call creates a GUID directory under the actual user's Documents/BIMPersonalAgent/FamilyExports, never overwrites the source, and never loads a family into a project. No destructive confirmation is required for this previously authorized new-file/save-copy workflow. Atomic plans and Harness execution remain excluded because this command owns a separate family document and transaction.

After saving, the family closes and reopens. Verification checks category, current type, text metadata, native form class, solid/void identity, part tags, final geometry bounds (0.1mm), and volume (max 0.1mm3 or 1ppm). Primitive bounds and analytic volumes are also checked before save. Cut component final volume is checked against an independent Boolean geometry calculation. Returned `Parts` describe pre-cut native component geometry; `FinalGeometry` describes the final cut combinations and standalone parts. Preserved source geometry is prefixed `Preserved:`. A failed saved file is reported with its path and is never called verified.

Geometry verification is not product certification or LOD certification. This version creates fixed-size native forms and BPA text metadata. Dimension-driven family flex, formula relationships, electrical connectors, IES photometry, light-source definitions and loading into the project are not implemented by this command. These require their own explicit authoring and verification when needed, rather than claiming success from a geometric envelope.

## Tests and deployment

Run `dotnet run --project tests/FamilyAuthoring.Tests/FamilyAuthoring.Tests.csproj`, `npm test` in gateway, and the Revit 2024 solution build. `tests/FamilyAuthoring.Tests/native-geometry-pilot.json` contains source-independent synthetic fixtures with analytic expected volumes, including a recessed cylinder, two-loop annulus, revolved reflector and rotated arc sweep. It is a tool validation fixture, not an approved product design. Run each request through Agent `run_bim_tool` after deployment and compare the returned measurements with the expected values. Run the negative live cases to verify transaction rollback. Compilation and parser/schema tests do not prove Revit runtime behaviour.

Update the Bridge assembly and Gateway build/catalog together. Save and close Revit before installing: the current add-in does not reload a changed assembly into an existing Revit process. Do not terminate Revit or replace a loaded assembly. Preserve deployment backups and verify the installed hashes. Reconnect the Gateway and verify schema 2.0.0 before the native geometry pilot; keep the tool experimental until the pilot is verified.

## Local extension release policy

Upstream repository and commit remain provenance records; they are not a feature allowlist. The integration hashes identify the reviewed local build, not an assertion that local extensions came from upstream. `config/family-authoring-extension.json` records local version 2.0.0 and both previous and reviewed integration hashes.

New fixtures using existing geometry operations are ordinary tool inputs. Adding a reusable geometry operation is a normal versioned source change: inspect the diff, add parser/schema and native pilot cases, run the build (which includes family validator tests), update the reviewed local integration record, package and verify installation, then record live Revit results. It does not require changing tool risk, public tool count or destructive-action permissions for every shape. User authorization on 2026-09-30 covers this local extension release workflow. Do not represent an untested operation as runtime-validated.

## 2.0.1 runtime correction

The first Revit pilot rolled back without saving because native GenericForm does not expose the instance Comments parameter used for part tags. Part identity now uses a dedicated Revit Extensible Storage schema, with immediate and reopened readback. This does not change execution permissions. Runtime validation remains pending until the corrected Bridge is loaded.

## 2.0.2 runtime corrections

Planar sweeps now receive an explicit path sketch plane; nonplanar sweeps use native reference curves. API runtime rejected a null sketch plane despite its XML optional annotation. Revit Solid.Volume documents tessellation approximation for curved surfaces: independent analytic/cut comparisons permit 0.1 percent relative volume error; box comparisons and saved/reopened consistency retain 1ppm, and bounds retain 0.1mm. Live annulus error was 0.00475 percent and revolved reflector error 0.0883 percent. Positive and negative cut checks remain enforced.

## 2.0.3 acceptance results (2026-09-30)

The native curve collector now uses CurveElement with ModelCurve post-filtering, as required by Revit 2024. Live tests passed: cylindrical recess/cut, annular profile, revolved reflector, rotated planar arc sweep, three expected cut rejections with no output file, and a source-preserving copy edit from 10mm to 12mm. Seven production lighting families (57 native forms) saved, reopened and passed envelope checks. Source files were not overwritten; no project family was loaded or replaced. Nonplanar reference-driven sweeps and arbitrary source-family constraint combinations remain untested; the descriptor stays experimental rather than generalizing this acceptance to those cases.
