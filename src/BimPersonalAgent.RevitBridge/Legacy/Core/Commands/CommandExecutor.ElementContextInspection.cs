using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Newtonsoft.Json.Linq;

#if REVIT2025_OR_GREATER
using IdType = System.Int64;
#else
using IdType = System.Int32;
#endif

namespace RevitMCP.Core
{
    public partial class CommandExecutor
    {
        private object InspectElementContext(JObject parameters)
        {
            UIDocument uiDocument = _uiApp.ActiveUIDocument;
            if (uiDocument == null)
            {
                throw new InvalidOperationException("No active Revit document.");
            }

            Document document = uiDocument.Document;
            string detail = (parameters.Value<string>("detail") ?? "summary").Trim().ToLowerInvariant();
            int maxParameters = Clamp(parameters.Value<int?>("maxParameters") ?? 200, 1, 500);
            bool includeDocumentPath = parameters.Value<bool?>("includeDocumentPath") ?? false;
            int maxViewsScanned = Math.Max(0, Math.Min(50, parameters.Value<int?>("maxViewsScanned") ?? 0));
            var warnings = new List<string>();
            if (maxViewsScanned > 0)
            {
                warnings.Add("maxViewsScanned is reserved for a later bounded visibility scan; this version reports active, owner, and sheet context only.");
            }

            Element element = ResolveInspectionElement(document, uiDocument, parameters, maxParameters);
            if (element == null)
            {
                return BuildSelectionResponse(document, uiDocument, maxParameters);
            }

            Element typeElement = SafeGetTypeElement(document, element);
            var parametersSnapshot = ShouldInclude(detail, "parameters", "full")
                ? ReadParameterRecords(element, "instance", maxParameters)
                : new ParameterSnapshot();
            var typeParametersSnapshot = ShouldInclude(detail, "parameters", "full")
                ? ReadParameterRecords(typeElement, "type", maxParameters)
                : new ParameterSnapshot();
            var geometry = ShouldInclude(detail, "geometry", "full") || detail == "summary"
                ? ReadGeometry(element, document.ActiveView)
                : null;
            var location = ShouldInclude(detail, "geometry", "location", "full") || detail == "summary"
                ? ReadLocation(element, document)
                : null;
            var relationships = ShouldInclude(detail, "relationships", "full") || detail == "summary"
                ? ReadRelationships(element, document, typeElement)
                : null;
            var viewContext = ShouldInclude(detail, "viewsheet", "view", "sheet", "full") || detail == "summary"
                ? ReadViewContext(element, document)
                : null;

            int parameterCount = parametersSnapshot.TotalCount + typeParametersSnapshot.TotalCount;
            int writableCount = parametersSnapshot.WritableCount + typeParametersSnapshot.WritableCount;
            int readOnlyCount = parametersSnapshot.ReadOnlyCount + typeParametersSnapshot.ReadOnlyCount;

            return new
            {
                SchemaVersion = "bim-agent.element-context.v1",
                GeneratedAtUtc = DateTime.UtcNow.ToString("o"),
                Source = "BIMPersonalAgent.RevitBridge",
                Status = "ok",
                Warnings = warnings,
                Document = new
                {
                    Title = document.Title,
                    PathName = includeDocumentPath ? document.PathName : null,
                    IsFamilyDocument = document.IsFamilyDocument,
                    RevitVersion = _uiApp.Application.VersionNumber,
                },
                ActiveView = ViewSummary(document.ActiveView),
                Identity = new
                {
                    ElementId = element.Id.GetIdValue(),
                    UniqueId = element.UniqueId,
                    Name = SafeName(element),
                    ClassName = element.GetType().Name,
                    Category = element.Category?.Name,
                    CategoryId = element.Category?.Id.GetIdValue(),
                },
                Classification = new
                {
                    TypeElementId = typeElement?.Id.GetIdValue(),
                    TypeName = SafeName(typeElement),
                    FamilyName = (element as FamilyInstance)?.Symbol?.FamilyName,
                    IsElementType = element is ElementType,
                    LevelId = IsValidId(element.LevelId) ? element.LevelId.GetIdValue() : (IdType?)null,
                    LevelName = ElementName(document.GetElement(element.LevelId)),
                },
                AgentSummary = new
                {
                    ElementId = element.Id.GetIdValue(),
                    Name = SafeName(element),
                    Category = element.Category?.Name,
                    TypeName = SafeName(typeElement),
                    ClassName = element.GetType().Name,
                    LevelName = ElementName(document.GetElement(element.LevelId)),
                    ParameterCount = parameterCount,
                    TypeParameterCount = typeParametersSnapshot.TotalCount,
                    WritableParameterCount = writableCount,
                    ReadOnlyParameterCount = readOnlyCount,
                    HasBoundingBox = geometry?.BoundingBox != null,
                    LocationKind = location?.Kind,
                    RelationshipCount = relationships?.Count ?? 0,
                    ViewContextKind = viewContext?.Kind,
                    ReadOnly = true,
                },
                Parameters = parametersSnapshot,
                TypeParameters = typeParametersSnapshot,
                Geometry = geometry,
                Location = location,
                Relationships = relationships,
                ViewContext = viewContext,
            };
        }

        private Element ResolveInspectionElement(Document document, UIDocument uiDocument, JObject parameters, int maxSelected)
        {
            JToken elementIdToken = parameters["elementId"];
            if (elementIdToken != null && elementIdToken.Type != JTokenType.Null)
            {
                IdType elementId = elementIdToken.Value<IdType>();
                Element element = document.GetElement(new ElementId(elementId));
                if (element == null)
                {
                    throw new InvalidOperationException("Element was not found: " + elementId);
                }

                return element;
            }

            var selectedIds = uiDocument.Selection.GetElementIds().ToArray();
            if (selectedIds.Length == 1)
            {
                return document.GetElement(selectedIds[0]);
            }

            return null;
        }

        private object BuildSelectionResponse(Document document, UIDocument uiDocument, int maxSelected)
        {
            var selectedIds = uiDocument.Selection.GetElementIds().ToArray();
            return new
            {
                SchemaVersion = "bim-agent.element-context.v1",
                GeneratedAtUtc = DateTime.UtcNow.ToString("o"),
                Source = "BIMPersonalAgent.RevitBridge",
                Status = selectedIds.Length == 0 ? "selection_required" : "multiple_selection",
                Message = selectedIds.Length == 0
                    ? "No elementId was provided and the current Revit selection is empty."
                    : "No elementId was provided and the current Revit selection contains multiple elements.",
                Selection = new
                {
                    TotalCount = selectedIds.Length,
                    ReturnedCount = Math.Min(selectedIds.Length, maxSelected),
                    Truncated = selectedIds.Length > maxSelected,
                    Elements = selectedIds.Take(maxSelected)
                        .Select(id => document.GetElement(id))
                        .Where(element => element != null)
                        .Select(element => new
                        {
                            ElementId = element.Id.GetIdValue(),
                            Name = SafeName(element),
                            Category = element.Category?.Name,
                            TypeName = SafeName(SafeGetTypeElement(document, element)),
                            ClassName = element.GetType().Name,
                        })
                        .ToList(),
                },
            };
        }

        private ParameterSnapshot ReadParameterRecords(Element element, string scope, int maxParameters)
        {
            var snapshot = new ParameterSnapshot();
            if (element == null)
            {
                return snapshot;
            }

            var records = new List<object>();
            foreach (Parameter parameter in element.Parameters)
            {
                snapshot.TotalCount++;
                if (parameter.IsReadOnly) snapshot.ReadOnlyCount++;
                else snapshot.WritableCount++;

                if (records.Count >= maxParameters)
                {
                    snapshot.Truncated = true;
                    continue;
                }

                records.Add(ReadParameterRecord(parameter, element, scope));
            }

            snapshot.ReturnedCount = records.Count;
            snapshot.Records = records;
            return snapshot;
        }

        private object ReadParameterRecord(Parameter parameter, Element sourceElement, string scope)
        {
            string builtInParameter = null;
            try
            {
                if (parameter.Definition is InternalDefinition internalDefinition)
                {
                    BuiltInParameter bip = internalDefinition.BuiltInParameter;
                    if (bip != BuiltInParameter.INVALID)
                    {
                        builtInParameter = bip.ToString();
                    }
                }
            }
            catch
            {
                builtInParameter = null;
            }

            return new
            {
                Scope = scope,
                Name = SafeDefinitionName(parameter),
                StorageType = parameter.StorageType.ToString(),
                ValueRaw = SafeRawValue(parameter),
                ValueDisplay = SafeDisplayValue(parameter),
                IsReadOnly = parameter.IsReadOnly,
                IsWritable = !parameter.IsReadOnly,
                HasValue = SafeHasValue(parameter),
                IsShared = SafeIsShared(parameter),
                IsBuiltIn = builtInParameter != null,
                BuiltInParameter = builtInParameter,
                SourceElementId = sourceElement?.Id.GetIdValue(),
            };
        }

        private ElementGeometrySnapshot ReadGeometry(Element element, View activeView)
        {
            BoundingBoxXYZ box = null;
            try
            {
                box = element.get_BoundingBox(activeView) ?? element.get_BoundingBox(null);
            }
            catch
            {
                box = null;
            }

            var counts = new GeometryCounts();
            try
            {
                var options = new Options
                {
                    ComputeReferences = false,
                    DetailLevel = ViewDetailLevel.Coarse,
                    IncludeNonVisibleObjects = false,
                };
                GeometryElement geometry = element.get_Geometry(options);
                CountGeometry(geometry, counts);
            }
            catch
            {
                counts.Warnings.Add("Geometry count failed for this element.");
            }

            return new ElementGeometrySnapshot
            {
                BoundingBox = box == null ? null : new
                {
                    Min = PointMm(box.Min),
                    Max = PointMm(box.Max),
                    Center = PointMm((box.Min + box.Max) * 0.5),
                },
                Counts = counts,
            };
        }

        private LocationSnapshot ReadLocation(Element element, Document document)
        {
            Location location = element.Location;
            if (location is LocationPoint point)
            {
                return new LocationSnapshot
                {
                    Kind = "point",
                    Point = PointMm(point.Point),
                    RotationRadians = point.Rotation,
                    LevelName = ElementName(document.GetElement(element.LevelId)),
                };
            }

            if (location is LocationCurve curveLocation)
            {
                Curve curve = curveLocation.Curve;
                XYZ start = curve?.GetEndPoint(0);
                XYZ end = curve?.GetEndPoint(1);
                return new LocationSnapshot
                {
                    Kind = "curve",
                    Start = start == null ? null : PointMm(start),
                    End = end == null ? null : PointMm(end),
                    LengthMm = curve == null ? (double?)null : ToMm(curve.Length),
                    LevelName = ElementName(document.GetElement(element.LevelId)),
                };
            }

            return new LocationSnapshot
            {
                Kind = location == null ? "none" : location.GetType().Name,
                LevelName = ElementName(document.GetElement(element.LevelId)),
            };
        }

        private List<object> ReadRelationships(Element element, Document document, Element typeElement)
        {
            var relationships = new List<object>();
            AddRelationship(relationships, "type", typeElement);
            AddRelationship(relationships, "level", document.GetElement(element.LevelId));
            if (element is FamilyInstance familyInstance)
            {
                AddRelationship(relationships, "family_symbol", familyInstance.Symbol);
                AddRelationship(relationships, "host", familyInstance.Host);
                AddRelationship(relationships, "super_component", familyInstance.SuperComponent);
            }

            AddRelationship(relationships, "owner_view", document.GetElement(element.OwnerViewId));
            AddRelationship(relationships, "group", document.GetElement(element.GroupId));
            AddRelationship(relationships, "assembly", document.GetElement(element.AssemblyInstanceId));
            AddRelationship(relationships, "design_option", element.DesignOption);
            AddRelationship(relationships, "created_phase", document.GetElement(element.CreatedPhaseId));
            AddRelationship(relationships, "demolished_phase", document.GetElement(element.DemolishedPhaseId));

            try
            {
                foreach (ElementId materialId in element.GetMaterialIds(false).Take(20))
                {
                    AddRelationship(relationships, "material", document.GetElement(materialId));
                }
            }
            catch
            {
                // Some element types do not expose material ids safely.
            }

            return relationships;
        }

        private ViewContextSnapshot ReadViewContext(Element element, Document document)
        {
            View activeView = document.ActiveView;
            View ownerView = document.GetElement(element.OwnerViewId) as View;
            var snapshot = new ViewContextSnapshot
            {
                Kind = ownerView != null ? "view_specific" : "model_element",
                ActiveView = ViewSummary(activeView),
                OwnerView = ViewSummary(ownerView),
            };

            if (element is Viewport viewport)
            {
                snapshot.Kind = "viewport";
                snapshot.View = ViewSummary(document.GetElement(viewport.ViewId) as View);
                ViewSheet sheet = document.GetElement(viewport.SheetId) as ViewSheet;
                snapshot.Sheet = SheetSummary(sheet);
            }
            else if (element is ViewSheet sheet)
            {
                snapshot.Kind = "sheet";
                snapshot.Sheet = SheetSummary(sheet);
            }
            else if (element is View view)
            {
                snapshot.Kind = "view";
                snapshot.View = ViewSummary(view);
            }

            return snapshot;
        }

        private void CountGeometry(GeometryElement geometry, GeometryCounts counts)
        {
            if (geometry == null)
            {
                return;
            }

            foreach (GeometryObject geometryObject in geometry)
            {
                CountGeometryObject(geometryObject, counts);
            }
        }

        private void CountGeometryObject(GeometryObject geometryObject, GeometryCounts counts)
        {
            if (geometryObject == null)
            {
                return;
            }

            counts.ObjectCount++;
            if (geometryObject is Solid solid)
            {
                counts.SolidCount++;
                counts.FaceCount += solid.Faces?.Size ?? 0;
                counts.EdgeCount += solid.Edges?.Size ?? 0;
            }
            else if (geometryObject is Curve)
            {
                counts.CurveCount++;
            }
            else if (geometryObject is Mesh mesh)
            {
                counts.MeshCount++;
                counts.TriangleCount += mesh.NumTriangles;
            }
            else if (geometryObject is GeometryInstance instance)
            {
                counts.InstanceCount++;
                try
                {
                    CountGeometry(instance.GetInstanceGeometry(), counts);
                }
                catch
                {
                    counts.Warnings.Add("Nested geometry instance could not be expanded.");
                }
            }
        }

        private Element SafeGetTypeElement(Document document, Element element)
        {
            if (element == null)
            {
                return null;
            }

            try
            {
                ElementId typeId = element.GetTypeId();
                return IsValidId(typeId) ? document.GetElement(typeId) : null;
            }
            catch
            {
                return null;
            }
        }

        private static bool ShouldInclude(string detail, params string[] names)
        {
            return detail == "full" || names.Contains(detail);
        }

        private static bool IsValidId(ElementId id)
        {
            return id != null && id != ElementId.InvalidElementId;
        }

        private static string SafeName(Element element)
        {
            return element == null ? null : ElementName(element);
        }

        private static string ElementName(Element element)
        {
            if (element == null)
            {
                return null;
            }

            try
            {
                return element.Name;
            }
            catch
            {
                return null;
            }
        }

        private static string SafeDefinitionName(Parameter parameter)
        {
            try
            {
                return parameter.Definition?.Name;
            }
            catch
            {
                return null;
            }
        }

        private static bool SafeHasValue(Parameter parameter)
        {
            try
            {
                return parameter.HasValue;
            }
            catch
            {
                return false;
            }
        }

        private static bool SafeIsShared(Parameter parameter)
        {
            try
            {
                return parameter.IsShared;
            }
            catch
            {
                return false;
            }
        }

        private static object SafeRawValue(Parameter parameter)
        {
            try
            {
                switch (parameter.StorageType)
                {
                    case StorageType.String:
                        return parameter.AsString();
                    case StorageType.Double:
                        return parameter.AsDouble();
                    case StorageType.Integer:
                        return parameter.AsInteger();
                    case StorageType.ElementId:
                        ElementId id = parameter.AsElementId();
                        return IsValidId(id) ? (object)id.GetIdValue() : null;
                    default:
                        return null;
                }
            }
            catch
            {
                return null;
            }
        }

        private static string SafeDisplayValue(Parameter parameter)
        {
            try
            {
                return parameter.AsValueString() ?? parameter.AsString();
            }
            catch
            {
                return null;
            }
        }

        private static object ViewSummary(View view)
        {
            if (view == null)
            {
                return null;
            }

            return new
            {
                ViewId = view.Id.GetIdValue(),
                Name = ElementName(view),
                ViewType = view.ViewType.ToString(),
                IsTemplate = view.IsTemplate,
            };
        }

        private static object SheetSummary(ViewSheet sheet)
        {
            if (sheet == null)
            {
                return null;
            }

            return new
            {
                SheetId = sheet.Id.GetIdValue(),
                SheetNumber = sheet.SheetNumber,
                Name = ElementName(sheet),
            };
        }

        private static object PointMm(XYZ point)
        {
            if (point == null)
            {
                return null;
            }

            return new
            {
                X = Math.Round(ToMm(point.X), 3),
                Y = Math.Round(ToMm(point.Y), 3),
                Z = Math.Round(ToMm(point.Z), 3),
            };
        }

        private static double ToMm(double internalFeet)
        {
            return internalFeet * 304.8;
        }

        private static int Clamp(int value, int min, int max)
        {
            return Math.Max(min, Math.Min(max, value));
        }

        private static void AddRelationship(List<object> relationships, string relation, Element target)
        {
            if (target == null)
            {
                return;
            }

            relationships.Add(new
            {
                Relation = relation,
                ElementId = target.Id.GetIdValue(),
                Name = ElementName(target),
                Category = target.Category?.Name,
                ClassName = target.GetType().Name,
            });
        }

        private sealed class ParameterSnapshot
        {
            public int TotalCount { get; set; }
            public int ReturnedCount { get; set; }
            public bool Truncated { get; set; }
            public int WritableCount { get; set; }
            public int ReadOnlyCount { get; set; }
            public List<object> Records { get; set; } = new List<object>();
        }

        private sealed class ElementGeometrySnapshot
        {
            public object BoundingBox { get; set; }
            public GeometryCounts Counts { get; set; }
        }

        private sealed class GeometryCounts
        {
            public int ObjectCount { get; set; }
            public int SolidCount { get; set; }
            public int CurveCount { get; set; }
            public int MeshCount { get; set; }
            public int InstanceCount { get; set; }
            public int FaceCount { get; set; }
            public int EdgeCount { get; set; }
            public int TriangleCount { get; set; }
            public List<string> Warnings { get; set; } = new List<string>();
        }

        private sealed class LocationSnapshot
        {
            public string Kind { get; set; }
            public object Point { get; set; }
            public object Start { get; set; }
            public object End { get; set; }
            public double? LengthMm { get; set; }
            public double? RotationRadians { get; set; }
            public string LevelName { get; set; }
        }

        private sealed class ViewContextSnapshot
        {
            public string Kind { get; set; }
            public object ActiveView { get; set; }
            public object OwnerView { get; set; }
            public object View { get; set; }
            public object Sheet { get; set; }
        }
    }
}
