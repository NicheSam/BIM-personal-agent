using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.ExtensibleStorage;
using Newtonsoft.Json.Linq;

namespace RevitMCP.Core
{
    public partial class CommandExecutor
    {
        private object CreateParametricCabinetFiles(JObject input)
        {
            var jobs = ParametricCabinetSpec.Validate(input); // Validate the whole batch before any file creation.
            if (_uiApp.ActiveUIDocument?.Document.IsModifiable == true) throw new InvalidOperationException("Direct call outside a project transaction required.");
            string template = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Autodesk", "RVT " + _uiApp.Application.VersionNumber, "Family Templates", "English", "Metric Electrical Equipment.rft");
            if (!File.Exists(template)) throw new InvalidOperationException("Electrical equipment template missing.");
            string folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "BIMPersonalAgent", "FamilyExports", Guid.NewGuid().ToString("N"));
            var completed = new List<object>();
            foreach (JObject job in jobs)
            {
                string name = (string)job["name"], path = Path.Combine(folder, name + ".rfa");
                Document doc = null;
                string stage = "new_family";
                try
                {
                    doc = _uiApp.Application.NewFamilyDocument(template);
                    stage = "build_geometry";
                    CabinetTransaction(doc, "Build parametric cabinet", () => BuildParametricCabinet(doc, job));
                    int checkIndex = 0;
                    foreach (JObject check in (JArray)job["checks"])
                    {
                        stage = "flex_" + (++checkIndex);
                        CabinetTransaction(doc, "Flex cabinet dimensions", () => {
                            foreach (var p in ((JObject)check["values"]).Properties()) doc.FamilyManager.Set(doc.FamilyManager.get_Parameter(p.Name), (double)p.Value / 304.8);
                        });
                        VerifyParametricCabinet(doc, job, check);
                    }
                    Directory.CreateDirectory(folder);
                    stage = "save";
                    doc.SaveAs(path, new SaveAsOptions { OverwriteExistingFile = false, MaximumBackups = 1 });
                    if (!doc.Close(false)) throw new InvalidOperationException("Owned family could not close.");
                    doc = null;
                    stage = "reopen_verify";
                    doc = _uiApp.Application.OpenDocumentFile(path);
                    VerifyParametricCabinet(doc, job, (JObject)((JArray)job["checks"]).Last);
                    if (doc.GetWarnings().Count != 0) throw new InvalidOperationException("Saved family contains warnings.");
                    if (!doc.Close(false)) throw new InvalidOperationException("Reopened family could not close.");
                    doc = null;
                    completed.Add(new { name, path, status = "verified", reopened = true, flexChecks = ((JArray)job["checks"]).Count, ports = ((JArray)job["ports"]).Count, labels = ((JArray)job["labels"])?.Count ?? 0 });
                }
                catch (Exception ex)
                {
                    return new { status = "partial_failed", completed, failedName = name, stage, errorType = ex.GetType().FullName, error = ex.Message, errorStack = ex.StackTrace, unverifiedFile = File.Exists(path) ? path : null, remaining = jobs.Skip(completed.Count + 1).Select(j => (string)j["name"]).ToArray(), projectModified = false };
                }
                finally { if (doc != null && doc.IsValidObject) doc.Close(false); }
            }
            return new { status = "verified", completed, projectModified = false, projectConnectionTested = false };
        }

        private void CabinetTransaction(Document d, string label, Action action)
        {
            using (var tx = new Transaction(d, label))
            {
                tx.Start();
                var failures = new CabinetBuildFailures();
                tx.SetFailureHandlingOptions(tx.GetFailureHandlingOptions().SetFailuresPreprocessor(failures).SetClearAfterRollback(true));
                action(); d.Regenerate();
                if (tx.Commit() != TransactionStatus.Committed) throw new InvalidOperationException(label + ": " + string.Join("; ", failures.Errors));
            }
            if (d.GetWarnings().Count != 0) throw new InvalidOperationException(label + " produced warnings.");
        }

        private sealed class CabinetBuildFailures : IFailuresPreprocessor
        {
            internal readonly List<string> Errors = new List<string>();
            public FailureProcessingResult PreprocessFailures(FailuresAccessor accessor)
            {
                foreach (var message in accessor.GetFailureMessages()) Errors.Add(message.GetDescriptionText());
                return Errors.Count > 0 ? FailureProcessingResult.ProceedWithRollBack : FailureProcessingResult.Continue;
            }
        }

        private void BuildParametricCabinet(Document d, JObject job)
        {
            var fm = d.FamilyManager;
            fm.NewType((string)job["name"]);
            foreach (JObject p in (JArray)job["parameters"])
                fm.Set(fm.AddParameter((string)p["name"], GroupTypeId.Geometry, SpecTypeId.Length, false), (double)p["valueMm"] / 304.8);
            foreach (JObject p in (JArray)job["derivedParameters"] ?? new JArray())
                fm.SetFormula(fm.AddParameter((string)p["name"], GroupTypeId.Geometry, SpecTypeId.Length, false), (string)p["total"] + " - " + (string)p["subtract"]);
            var views = new FilteredElementCollector(d).OfClass(typeof(View)).Cast<View>().Where(v => !v.IsTemplate).ToList();
            var plan = views.First(v => v.ViewType == ViewType.FloorPlan);
            var front = views.First(v => v.ViewType == ViewType.Elevation && Math.Abs(v.ViewDirection.Y) > 0.99);
            var refs = new Dictionary<string, ReferencePlane>();
            var coords = new Dictionary<string, double>();
            var axes = new Dictionary<string, int>();
            foreach (JObject p in (JArray)job["planes"])
            {
                string n = (string)p["name"]; int a = (int)p["axis"]; double v = (double)p["mm"] / 304.8;
                ReferencePlane plane;
                if (a == 0) plane = d.FamilyCreate.NewReferencePlane(new XYZ(v, -40, 0), new XYZ(v, 40, 0), XYZ.BasisZ, plan);
                else if (a == 1) plane = d.FamilyCreate.NewReferencePlane(new XYZ(-40, v, 0), new XYZ(40, v, 0), XYZ.BasisZ, plan);
                else plane = d.FamilyCreate.NewReferencePlane(new XYZ(-40, 0, v), new XYZ(40, 0, v), XYZ.BasisY, front);
                plane.Name = "S_" + n; plane.Pinned = (bool?)p["pinned"] ?? false;
                refs[n] = plane; coords[n] = v; axes[n] = a;
            }
            foreach (JObject p in (JArray)job["dimensions"])
            {
                d.Regenerate(); var names = ((JArray)p["refs"]).Select(t => (string)t).ToArray(); int axis = axes[names[0]];
                var array = new ReferenceArray(); foreach (string n in names) array.Append(refs[n].GetReference());
                Func<double, XYZ> point = v => axis == 0 ? new XYZ(v, -42, 0) : axis == 1 ? new XYZ(-42, v, 0) : new XYZ(-42, 0, v);
                var dim = d.FamilyCreate.NewLinearDimension(axis == 2 ? front : plan, Line.CreateBound(point(coords[names.First()]), point(coords[names.Last()])), array);
                if (names.Length == 3) dim.AreSegmentsEqual = true;
                else if (p["parameter"] != null) dim.FamilyLabel = fm.get_Parameter((string)p["parameter"]);
                else dim.IsLocked = true;
            }
            var parts = new Dictionary<string, Extrusion>();
            FamilyParameter materialParameter = null;
            if (job["material"] != null)
            {
                var materialId = Material.Create(d, (string)job["material"]);
                materialParameter = fm.AddParameter("\u76e4\u9ad4\u6750\u8cea", GroupTypeId.Materials, SpecTypeId.Reference.Material, false);
                fm.Set(materialParameter, materialId);
            }
            foreach (JObject p in (JArray)job["parts"])
            {
                var names = ((JArray)p["planes"]).Select(t => (string)t).ToArray(); var b = names.Select(n => coords[n]).ToArray();
                var sketch = SketchPlane.Create(d, Plane.CreateByNormalAndOrigin(XYZ.BasisZ, new XYZ(0, 0, b[2])));
                var loop = new CurveArray(); var points = new[] {new XYZ(b[0],b[1],b[2]),new XYZ(b[3],b[1],b[2]),new XYZ(b[3],b[4],b[2]),new XYZ(b[0],b[4],b[2])};
                for (int i = 0; i < 4; i++) loop.Append(Line.CreateBound(points[i], points[(i + 1) % 4]));
                var loops = new CurveArrArray(); loops.Append(loop);
                var form = d.FamilyCreate.NewExtrusion(true, loops, sketch, b[5] - b[2]);
                var identity = new Entity(FamilyPartSchema());
                identity.Set<string>("PartName", (string)p["name"]);
                form.SetEntity(identity);
                if (materialParameter != null && (bool?)p["hidden"] != true)
                    fm.AssociateElementParameterToFamilyParameter(form.get_Parameter(BuiltInParameter.MATERIAL_ID_PARAM), materialParameter);
                if (ReadFamilyPartName(form) != (string)p["name"]) throw new InvalidOperationException("Part identity did not persist.");
                if ((bool?)p["hidden"] == true) form.get_Parameter(BuiltInParameter.IS_VISIBLE_PARAM).Set(0);
                d.Regenerate();
                foreach (string n in names)
                {
                    int axis = axes[n];
                    var face = CabinetFaces(form).First(f => Math.Abs(CabinetComponent(f.FaceNormal, axis)) > .99 && Math.Abs(CabinetComponent(f.Origin, axis) - coords[n]) < 1e-6);
                    d.FamilyCreate.NewAlignment(axis == 2 ? front : plan, refs[n].GetReference(), face.Reference);
                }
                parts.Add((string)p["name"], form);
            }
            d.Regenerate();
            foreach (JObject p in (JArray)job["ports"])
            {
                int side = (int)p["face"], axis = side % 3; double sign = side < 3 ? -1 : 1;
                var face = CabinetFaces(parts[(string)p["part"]]).First(f => CabinetComponent(f.FaceNormal, axis) * sign > .99);
                var port = ConnectorElement.CreateConduitConnector(d, face.Reference);
                var diameter = port.get_Parameter(BuiltInParameter.CONNECTOR_DIAMETER);
                var description = port.get_Parameter(BuiltInParameter.RBS_CONNECTOR_DESCRIPTION);
                if (diameter == null || description == null) throw new InvalidOperationException("Connector parameter unavailable: " + (string)p["name"]);
                diameter.Set((double)p["diameterMm"] / 304.8);
                description.Set((string)p["name"]);
            }
            BuildCabinetLabels(d, job, refs);
        }
        private void BuildCabinetLabels(Document d, JObject job, Dictionary<string, ReferencePlane> refs)
        {
            var labels = (JArray)job["labels"] ?? new JArray();
            if (labels.Count == 0) return;
            var fm = d.FamilyManager;
            var front = new FilteredElementCollector(d).OfClass(typeof(View)).Cast<View>().First(v => !v.IsTemplate && v.ViewType == ViewType.Elevation && v.ViewDirection.Y > .99);
            var original = new FilteredElementCollector(d).OfClass(typeof(ModelTextType)).Cast<ModelTextType>().First();
            var types = new Dictionary<double, ModelTextType>();
            int index = 0;
            foreach (JObject spec in labels)
            {
                double size = (double)spec["fontMm"];
                if (!types.ContainsKey(size))
                {
                    var type = (ModelTextType)original.Duplicate("\u76e4\u9762\u9298\u724c_" + types.Count);
                    type.get_Parameter(BuiltInParameter.MODEL_TEXT_SIZE).Set(size / 304.8);
                    types[size] = type;
                }
                var host = refs[(string)spec["frontPlane"]];
                var zHost = refs[(string)spec["zPlane"]];
                double y = host.GetPlane().Origin.Y, z = zHost.GetPlane().Origin.Z + (double)spec["zOffsetMm"] / 304.8;
                var text = d.FamilyCreate.NewModelText((string)spec["text"], types[size], SketchPlane.Create(d, host.GetReference()), new XYZ(0, y, z), HorizontalAlign.Center, (double)spec["depthMm"] / 304.8);
                var parameter = fm.AddParameter((string)spec["parameter"], GroupTypeId.IdentityData, SpecTypeId.String.Text, false);
                fm.Set(parameter, (string)spec["text"]);
                fm.AssociateElementParameterToFamilyParameter(text.get_Parameter(BuiltInParameter.TEXT_TEXT), parameter);
                // ModelText's LocationPoint is in the reference-plane frame, not glyph world X.
                var point = (LocationPoint)text.Location;
                point.Point = new XYZ(-host.GetPlane().Origin.X, y, point.Point.Z);
                d.Regenerate();
                var face = text.get_Geometry(new Options { ComputeReferences = true, IncludeNonVisibleObjects = true }).OfType<Solid>()
                    .SelectMany(s => s.Faces.Cast<Face>()).OfType<PlanarFace>()
                    .Where(f => f.FaceNormal.Z > .99 && f.Reference != null).OrderByDescending(f => f.Origin.Z).First();
                var plane = d.FamilyCreate.NewReferencePlane(new XYZ(-40, 0, face.Origin.Z), new XYZ(40, 0, face.Origin.Z), XYZ.BasisY, front);
                plane.Name = "Label_Z_" + index++;
                d.Regenerate(); // New reference geometry must exist before creating its dimension.
                var array = new ReferenceArray(); array.Append(zHost.GetReference()); array.Append(plane.GetReference());
                var dim = d.FamilyCreate.NewLinearDimension(front, Line.CreateBound(new XYZ(-42, 0, zHost.GetPlane().Origin.Z), new XYZ(-42, 0, face.Origin.Z)), array);
                dim.IsLocked = true;
                d.Regenerate();
                d.FamilyCreate.NewAlignment(front, plane.GetReference(), face.Reference);
            }
        }
        private static double CabinetComponent(XYZ p, int a) { return a == 0 ? p.X : a == 1 ? p.Y : p.Z; }
        private static IEnumerable<PlanarFace> CabinetFaces(Extrusion form)
        {
            return form.get_Geometry(new Options { ComputeReferences = true, IncludeNonVisibleObjects = true }).OfType<Solid>().Where(s => s.Volume > 0).SelectMany(s => s.Faces.Cast<Face>()).OfType<PlanarFace>();
        }
        private static void VerifyParametricCabinet(Document d, JObject job, JObject check)
        {
            if (!d.IsFamilyDocument || d.OwnerFamily.FamilyCategory.Id.Value != (long)BuiltInCategory.OST_ElectricalEquipment || d.FamilyManager.CurrentType.Name != (string)job["name"]) throw new InvalidOperationException("Family identity mismatch.");
            foreach (var p in ((JObject)check["values"]).Properties())
                if (Math.Abs(d.FamilyManager.CurrentType.AsDouble(d.FamilyManager.get_Parameter(p.Name)).Value * 304.8 - (double)p.Value) > .1) throw new InvalidOperationException("Parameter mismatch: " + p.Name);
            foreach (JObject p in (JArray)job["derivedParameters"] ?? new JArray())
            {
                double expected = (double)check["values"][(string)p["total"]] - (double)check["values"][(string)p["subtract"]];
                if (Math.Abs(d.FamilyManager.CurrentType.AsDouble(d.FamilyManager.get_Parameter((string)p["name"])).Value * 304.8 - expected) > .1) throw new InvalidOperationException("Derived parameter mismatch.");
            }
            var forms = new FilteredElementCollector(d).OfClass(typeof(Extrusion)).Cast<Extrusion>().ToList();
            if (forms.Count != ((JArray)job["parts"]).Count) throw new InvalidOperationException("Part count mismatch.");
            foreach (var p in ((JObject)check["bounds"]).Properties())
            {
                var form = forms.Single(f => ReadFamilyPartName(f) == p.Name);
                var spec = ((JArray)job["parts"]).Single(s => (string)s["name"] == p.Name);
                if (form.get_Parameter(BuiltInParameter.IS_VISIBLE_PARAM).AsInteger() != ((bool?)spec["hidden"] == true ? 0 : 1)) throw new InvalidOperationException("Part visibility mismatch: " + p.Name);
                var points = form.get_Geometry(new Options { IncludeNonVisibleObjects = true }).OfType<Solid>().Where(s => s.Volume > 0).SelectMany(s => s.Edges.Cast<Edge>()).SelectMany(e => e.Tessellate()).ToList();
                for (int axis = 0; axis < 3; axis++)
                    if (Math.Abs(points.Min(v => CabinetComponent(v, axis)) * 304.8 - (double)p.Value[axis]) > .1 || Math.Abs(points.Max(v => CabinetComponent(v, axis)) * 304.8 - (double)p.Value[axis + 3]) > .1) throw new InvalidOperationException("Flex geometry mismatch: " + p.Name);
            }
            var ports = new FilteredElementCollector(d).OfClass(typeof(ConnectorElement)).Cast<ConnectorElement>().ToList();
            if (ports.Count != ((JArray)job["ports"]).Count) throw new InvalidOperationException("Connector count mismatch.");
            foreach (JObject spec in (JArray)job["ports"])
            {
                string name = (string)spec["name"]; var port = ports.Single(p => p.get_Parameter(BuiltInParameter.RBS_CONNECTOR_DESCRIPTION).AsString() == name);
                for (int a = 0; a < 3; a++) if (Math.Abs(CabinetComponent(port.Origin, a) * 304.8 - (double)check["ports"][name][a]) > .1) throw new InvalidOperationException("Connector position mismatch: " + name);
                int side = (int)spec["face"];
                if (CabinetComponent(port.CoordinateSystem.BasisZ, side % 3) * (side < 3 ? -1 : 1) < .99 || Math.Abs(port.get_Parameter(BuiltInParameter.CONNECTOR_DIAMETER).AsDouble() * 304.8 - (double)spec["diameterMm"]) > .1) throw new InvalidOperationException("Connector direction or diameter mismatch: " + name);
            }
            var labels = (JArray)job["labels"] ?? new JArray();
            var textElements = new FilteredElementCollector(d).OfClass(typeof(ModelText)).Cast<ModelText>().ToList();
            if (labels.Count != textElements.Count) throw new InvalidOperationException("Label count mismatch.");
            var planes = new FilteredElementCollector(d).OfClass(typeof(ReferencePlane)).Cast<ReferencePlane>().Where(p => p.Name.StartsWith("S_", StringComparison.Ordinal)).ToDictionary(p => p.Name);
            foreach (JObject spec in labels)
            {
                string name = (string)spec["parameter"];
                var text = textElements.Single(t => d.FamilyManager.GetAssociatedFamilyParameter(t.get_Parameter(BuiltInParameter.TEXT_TEXT))?.Definition.Name == name);
                if (text.Text != (string)spec["text"] || d.FamilyManager.CurrentType.AsString(d.FamilyManager.get_Parameter(name)) != (string)spec["text"])
                    throw new InvalidOperationException("Label text mismatch: " + name);
                double z = planes["S_" + (string)spec["zPlane"]].GetPlane().Origin.Z + (double)spec["zOffsetMm"] / 304.8;
                double y = planes["S_" + (string)spec["frontPlane"]].GetPlane().Origin.Y;
                if (Math.Abs(((LocationPoint)text.Location).Point.Z - z) * 304.8 > .1) throw new InvalidOperationException("Label height mismatch: " + name);
                var glyphs = text.get_Geometry(new Options { IncludeNonVisibleObjects = true }).OfType<Solid>().Where(s => Math.Abs(s.Volume) < 1e-9).SelectMany(s => s.Edges.Cast<Edge>()).SelectMany(e => e.Tessellate()).ToList();
                if (glyphs.Count == 0 || glyphs.Any(p => Math.Abs(p.Y - y) * 304.8 > .1) || Math.Abs((glyphs.Min(p => p.X) + glyphs.Max(p => p.X)) / 2) * 304.8 > (double)spec["fontMm"])
                    throw new InvalidOperationException("Label glyph placement mismatch: " + name);
                var type = (ModelTextType)d.GetElement(text.GetTypeId());
                if (Math.Abs(type.get_Parameter(BuiltInParameter.MODEL_TEXT_SIZE).AsDouble() * 304.8 - (double)spec["fontMm"]) > .1) throw new InvalidOperationException("Label size mismatch.");
            }
            if (job["material"] != null)
            {
                var parameter = d.FamilyManager.get_Parameter("\u76e4\u9ad4\u6750\u8cea");
                var material = d.GetElement(d.FamilyManager.CurrentType.AsElementId(parameter)) as Material;
                if (material?.Name != (string)job["material"]) throw new InvalidOperationException("Material mismatch.");
            }
        }
    }
}
