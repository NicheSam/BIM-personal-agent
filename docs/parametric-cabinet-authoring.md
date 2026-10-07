# Parametric cabinet batch authoring 1.1.0

Status: ModelText extension candidate; live verification pending. Version 1.0.0 geometry/ports previously passed live save/reopen.

Optional `labels` supplies up to 24 bounded ModelText lines: `parameter`, `text`,
`frontPlane` (axis Y), `zPlane` (axis Z), `zOffsetMm`, `fontMm`, `depthMm`.
Each line is a type text parameter. It is hosted on the front reference plane
and aligned by a referenced text face to an offset locked Z plane. World glyph
edges, parameter values, font size and location are verified after every flex
and after reopen. The label implementation follows the live-verified pilot;
batch runtime verification is still required. Optional `material` creates a
named material and associates all visible forms with a Chinese material parameter.

The internal `create_parametric_cabinet_files` command creates one to three new,
independent electrical-equipment RFA files. Filenames are panel names. All
outputs go to a fresh GUID folder under the actual user's Documents folder.
There are no caller-supplied file paths, scripts, overwrites, project loads, or
changes to the active project. This command is excluded from atomic plans in
both Gateway entry points and the Bridge. The six public tools and dynamic C#
policy are unchanged.

The declaration contains bounded length parameters, reference planes, labeled
or locked dimensions, equality constraints, native box forms, and conduit
connectors hosted on selected form faces. A derived parameter may subtract one
named input parameter from another; arbitrary formulas are not accepted.
Part-plane order is xmin, ymin, zmin, xmax, ymax, zmax. Face indices 0/1/2 are
negative X/Y/Z and 3/4/5 are positive X/Y/Z. All input lengths use millimetres.

Every flex check supplies all input values and expected bounds for every part,
plus every connector's expected location. Each check commits separately before
measurement. Last check must restore baseline. Verification measures solid
edges, parameter values, derived values, visibility, connector diameter and
orientation, and counts. Any Revit warning or error rolls back the transaction.
After save, the owned document is closed, reopened, and baseline checked again.
Only documents created/opened by this command are closed. The first failure
stops the batch and identifies already verified outputs, any unverified file,
and unattempted jobs. Partial success is never reported as complete success.

Official API reference: installed Revit 2024 RevitAPI.xml entries for
NewReferencePlane, NewLinearDimension, NewAlignment, NewExtrusion,
ConnectorElement.CreateConduitConnector, SaveAs and OpenDocumentFile.

`tests/fixtures/cabinet-pilot.json` reproduces the accepted two-zone pilot's
seven Chinese parameters, ten visible forms, four hidden connector pads and
four conduit connectors. Eight checks cover width/height/depth increases and
decreases, partition change, and restoration. Port positions and diameters
remain provisional engineering inputs; passing geometry checks does not imply
approved fabrication holes or a tested project conduit connection.

Remaining panel declarations must follow individual source cards, including
one/two/three compartments and distinct side accessories. The tool does not
infer missing design information or substitute a generic box for every panel.
