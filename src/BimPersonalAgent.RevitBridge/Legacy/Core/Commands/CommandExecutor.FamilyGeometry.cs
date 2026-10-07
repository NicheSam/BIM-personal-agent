using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.ExtensibleStorage;

namespace RevitMCP.Core
{
    public partial class CommandExecutor
    {
        private static readonly Guid FamilyPartSchemaId = new Guid("6faf1ab3-c69d-48aa-ad48-bbbebf49a3bc");
        private static Schema FamilyPartSchema()
        {
            var schema=Schema.Lookup(FamilyPartSchemaId);
            if(schema!=null) return schema;
            var builder=new SchemaBuilder(FamilyPartSchemaId);
            builder.SetSchemaName("BPAFamilyPartIdentity");
            builder.SetReadAccessLevel(AccessLevel.Public);
            builder.SetWriteAccessLevel(AccessLevel.Public);
            builder.AddSimpleField("PartName",typeof(string));
            return builder.Finish();
        }
        private static string ReadFamilyPartName(Element form)
        {
            var schema=Schema.Lookup(FamilyPartSchemaId);
            if(schema==null) return null;
            var entity=form.GetEntity(schema);
            return entity.IsValid()?entity.Get<string>("PartName"):null;
        }

        private sealed class FamilyGeometryEvidence
        {
            public string Part, UniqueId, NativeType;
            public bool IsVoid;
            public double[] BoundsMm;
            public double VolumeMm3;
        }

        private sealed class FamilyBuildFailures : IFailuresPreprocessor
        {
            public readonly List<string> Errors = new List<string>();
            public FailureProcessingResult PreprocessFailures(FailuresAccessor failures)
            {
                foreach (var failure in failures.GetFailureMessages())
                {
                    if (failure.GetSeverity() == FailureSeverity.Warning) failures.DeleteWarning(failure);
                    else Errors.Add(failure.GetDescriptionText());
                }
                return Errors.Count > 0 ? FailureProcessingResult.ProceedWithRollBack : FailureProcessingResult.Continue;
            }
        }

        private static XYZ FamilyPoint(double[] p, bool radial = false)
        {
            return radial ? new XYZ(p[0]/304.8,0,p[1]/304.8) : new XYZ(p[0]/304.8,p[1]/304.8,p.Length==3?p[2]/304.8:0);
        }
        private static CurveArray FamilyCurves(IEnumerable<FamilyCurveSpec> source, bool radial = false)
        {
            var curves = new CurveArray();
            foreach (var c in source)
            {
                XYZ start=FamilyPoint(c.Start,radial), end=FamilyPoint(c.End,radial);
                curves.Append(c.Mid==null ? (Curve)Line.CreateBound(start,end) : Arc.Create(start,end,FamilyPoint(c.Mid,radial)));
            }
            return curves;
        }
        private GenericForm BuildFamilyForm(Document doc, FamilyPart p)
        {
            var profile = new CurveArrArray();
            if (p.Kind == "box" || p.Kind == "cylinder")
            {
                var curves = new CurveArray();
                if (p.Kind == "cylinder")
                {
                    curves.Append(Arc.Create(XYZ.Zero,p.Width/609.6,0,Math.PI,XYZ.BasisX,XYZ.BasisY));
                    curves.Append(Arc.Create(XYZ.Zero,p.Width/609.6,Math.PI,2*Math.PI,XYZ.BasisX,XYZ.BasisY));
                }
                else
                {
                    double w=p.Width/609.6, d=p.Depth/609.6;
                    XYZ[] v={new XYZ(-w,-d,0),new XYZ(w,-d,0),new XYZ(w,d,0),new XYZ(-w,d,0)};
                    for(int i=0;i<4;i++) curves.Append(Line.CreateBound(v[i],v[(i+1)%4]));
                }
                profile.Append(curves);
            }
            else foreach (var loop in p.Profile) profile.Append(FamilyCurves(loop,p.Kind=="revolution"));
            var transformIds=new List<ElementId>();
            GenericForm form;
            if (p.Kind=="revolution")
            {
                var plane=SketchPlane.Create(doc,Plane.CreateByNormalAndOrigin(XYZ.BasisY,XYZ.Zero));
                form=doc.FamilyCreate.NewRevolution(true,profile,plane,Line.CreateBound(XYZ.Zero,XYZ.BasisZ),p.StartAngle*Math.PI/180,p.EndAngle*Math.PI/180);
            }
            else if (p.Kind=="sweep")
            {
                var sweepProfile=_uiApp.Application.Create.NewCurveLoopsProfile(profile);
                var curves=FamilyCurves(p.Path);
                var points=p.Path.SelectMany(c=>c.Mid==null?new[]{c.Start,c.End}:new[]{c.Start,c.Mid,c.End}).Select(v=>FamilyPoint(v)).ToList();
                XYZ origin=points[0], direction=(points.Last()-origin).Normalize();
                if(direction.GetLength()<1e-9) direction=(points[1]-origin).Normalize();
                XYZ normal=null;
                foreach(var a in points.Skip(1))
                    foreach(var b in points.Skip(1))
                        if(normal==null && (a-origin).CrossProduct(b-origin).GetLength()>1e-9) normal=(a-origin).CrossProduct(b-origin).Normalize();
                if(normal==null) normal=direction.CrossProduct(Math.Abs(direction.Z)<0.9?XYZ.BasisZ:XYZ.BasisX).Normalize();
                bool planar=points.All(v=>Math.Abs((v-origin).DotProduct(normal))<1e-7);
                if(planar)
                    form=doc.FamilyCreate.NewSweep(true,curves,SketchPlane.Create(doc,Plane.CreateByNormalAndOrigin(normal,origin)),sweepProfile,0,ProfilePlaneLocation.Start);
                else
                {
                    var references=new ReferenceArray();
                    foreach(Curve curve in curves)
                    {
                        var arc=curve as Arc;
                        var tangent=(curve.GetEndPoint(1)-curve.GetEndPoint(0)).Normalize();
                        var n=arc!=null?arc.Normal:tangent.CrossProduct(Math.Abs(tangent.Z)<0.9?XYZ.BasisZ:XYZ.BasisX).Normalize();
                        var pathCurve=doc.FamilyCreate.NewModelCurve(curve,SketchPlane.Create(doc,Plane.CreateByNormalAndOrigin(n,curve.GetEndPoint(0))));
                        pathCurve.ChangeToReferenceLine();
                        var tag=new Entity(FamilyPartSchema()); tag.Set<string>("PartName",p.Name+"__Path");pathCurve.SetEntity(tag);
                        transformIds.Add(pathCurve.Id);
                        references.Append(pathCurve.GeometryCurve.Reference);
                    }
                    form=doc.FamilyCreate.NewSweep(true,references,sweepProfile,0,ProfilePlaneLocation.Start);
                }
            }
            else
            {
                var plane=SketchPlane.Create(doc,Plane.CreateByNormalAndOrigin(XYZ.BasisZ,XYZ.Zero));
                form=doc.FamilyCreate.NewExtrusion(true,profile,plane,p.Height/304.8);
            }
            transformIds.Add(form.Id);
            XYZ[] axes={XYZ.BasisX,XYZ.BasisY,XYZ.BasisZ};
            for(int i=0;i<3;i++) if (Math.Abs(p.Rotation[i])>1e-9)
                ElementTransformUtils.RotateElements(doc,transformIds,Line.CreateBound(XYZ.Zero,axes[i]),p.Rotation[i]*Math.PI/180);
            ElementTransformUtils.MoveElements(doc,transformIds,new XYZ(p.X/304.8,p.Y/304.8,p.Z/304.8));
            if (!p.IsVoid)
            {
                var material=new FilteredElementCollector(doc).OfClass(typeof(Material)).Cast<Material>().FirstOrDefault(m=>m.Name=="BPA_"+p.Name);
                if(material==null) material=(Material)doc.GetElement(Material.Create(doc,"BPA_"+p.Name));
                material.Color=new Color(p.R,p.G,p.B);
                form.get_Parameter(BuiltInParameter.MATERIAL_ID_PARAM).Set(material.Id);
            }
            var identity=new Entity(FamilyPartSchema());
            identity.Set<string>("PartName",p.Name);
            form.SetEntity(identity);
            if(ReadFamilyPartName(form)!=p.Name) throw new InvalidOperationException("Cannot persist part identity: "+p.Name);
            return form;
        }
        private static IEnumerable<Solid> FamilySolids(GeometryElement geometry)
        {
            if(geometry==null) yield break;
            foreach(var item in geometry)
            {
                var solid=item as Solid;
                if(solid!=null && solid.Volume>1e-12) yield return solid;
                var instance=item as GeometryInstance;
                if(instance!=null) foreach(var nested in FamilySolids(instance.GetInstanceGeometry())) yield return nested;
            }
        }
        private static Solid FamilySolid(Element element)
        {
            var solids=FamilySolids(element.get_Geometry(new Options { IncludeNonVisibleObjects=true, DetailLevel=ViewDetailLevel.Fine })).ToList();
            if(solids.Count==0) throw new InvalidOperationException("No measurable solid: "+element.Id);
            Solid result=SolidUtils.Clone(solids[0]);
            foreach(var solid in solids.Skip(1)) result=BooleanOperationsUtils.ExecuteBooleanOperation(result,solid,BooleanOperationsType.Union);
            return result;
        }
        private static FamilyGeometryEvidence MeasureFamilyElement(Element element, string name, bool isVoid)
        {
            var b=element.get_BoundingBox(null);
            if(b==null) throw new InvalidOperationException("Missing geometry bounds: "+name);
            return new FamilyGeometryEvidence { Part=name,UniqueId=element.UniqueId,NativeType=element.GetType().Name,IsVoid=isVoid,
                BoundsMm=new[]{b.Min.X*304.8,b.Min.Y*304.8,b.Min.Z*304.8,b.Max.X*304.8,b.Max.Y*304.8,b.Max.Z*304.8},
                VolumeMm3=FamilySolid(element).Volume*Math.Pow(304.8,3) };
        }

        private List<FamilyGeometryEvidence> BuildFamilyGeometry(Document doc, FamilyAuthoringSpec spec, out List<FamilyGeometryEvidence> identities)
        {
            var names=new HashSet<string>(spec.Parts.Select(p=>p.Name),StringComparer.OrdinalIgnoreCase);
            var oldForms=new FilteredElementCollector(doc).OfClass(typeof(GenericForm)).Cast<GenericForm>().Where(f=>{
                string marker=ReadFamilyPartName(f);
                string material=doc.GetElement(f.get_Parameter(BuiltInParameter.MATERIAL_ID_PARAM)?.AsElementId() ?? ElementId.InvalidElementId)?.Name;
                return names.Any(n=>marker==n || material=="BPA_"+n);
            }).ToList();
            // Reject dependent deletions in a trial transaction, preserving unmanaged source content.
            var allowed=new HashSet<ElementId>(oldForms.Select(f=>f.Id));
            var oldIds=oldForms.Select(f=>f.Id).ToList();
            oldIds.AddRange(new FilteredElementCollector(doc).OfClass(typeof(CurveElement)).OfType<ModelCurve>().Where(e=>names.Any(n=>ReadFamilyPartName(e)==n+"__Path")).Select(e=>e.Id));
            allowed.UnionWith(oldIds);
            foreach(var combination in new FilteredElementCollector(doc).OfClass(typeof(GeomCombination)).Cast<GeomCombination>())
                if(combination.AllMembers.Cast<GenericForm>().All(f=>allowed.Contains(f.Id))) allowed.Add(combination.Id);
            if(oldForms.Count>0)
            {
                using(var trial=new SubTransaction(doc))
                {
                    trial.Start();
                    var deleted=doc.Delete(oldIds);
                    // Sketches/curves are owned implementation details; any other deleted form is not.
                    trial.RollBack();
                    if(deleted.Any(id=>!allowed.Contains(id) && (doc.GetElement(id) is GenericForm || doc.GetElement(id) is GeomCombination || doc.GetElement(id) is Dimension)))
                        throw new InvalidOperationException("Named replacement has dependent forms/constraints. Use a fresh template or include the complete component.");
                }
                doc.Delete(oldIds);
            }
            var preservedElements=new FilteredElementCollector(doc).OfClass(typeof(GeomCombination)).ToList();
            preservedElements.AddRange(new FilteredElementCollector(doc).OfClass(typeof(GenericForm)).Cast<GenericForm>()
                .Where(f=>f.IsSolid && f.Combinations.Size==0));
            var preserved=preservedElements.Select(e=>MeasureFamilyElement(e,"Preserved:"+e.Id,false)).ToList();
            var preservedSolids=preservedElements.ToDictionary(e=>e.UniqueId,e=>FamilySolid(e));
            var forms=new Dictionary<string,GenericForm>(StringComparer.OrdinalIgnoreCase);
            foreach(var p in spec.Parts) forms.Add(p.Name,BuildFamilyForm(doc,p));
            doc.Regenerate();
            identities=spec.Parts.Select(p=>MeasureFamilyElement(forms[p.Name],p.Name,p.IsVoid)).ToList();
            foreach(var p in spec.Parts.Where(p=>(p.Kind=="box" || p.Kind=="cylinder") && p.Rotation.All(a=>Math.Abs(a)<1e-9)))
            {
                var evidence=identities.Single(e=>e.Part==p.Name);
                double depth=p.Kind=="cylinder"?p.Width:p.Depth;
                double[] expected={p.X-p.Width/2,p.Y-depth/2,p.Z,p.X+p.Width/2,p.Y+depth/2,p.Z+p.Height};
                if(evidence.BoundsMm.Zip(expected,(a,b)=>Math.Abs(a-b)).Any(d=>d>0.1)) throw new InvalidOperationException("Primitive dimensions differ: "+p.Name);
                double volume=p.Kind=="cylinder"?Math.PI*p.Width*p.Width*p.Height/4:p.Width*p.Depth*p.Height;
                // Revit Solid.Volume approximates curved surfaces (RevitAPI.xml Solid.Volume remarks).
                double volumeTolerance=p.Kind=="cylinder"?0.001:1e-6;
                if(Math.Abs(evidence.VolumeMm3-volume)>Math.Max(0.1,volume*volumeTolerance)) throw new InvalidOperationException("Primitive volume differs: "+p.Name+" actual="+evidence.VolumeMm3+" expected="+volume);
            }
            var solids=forms.ToDictionary(k=>k.Key,k=>FamilySolid(k.Value),StringComparer.OrdinalIgnoreCase);
            // Check each declared cut and reject unintended intersections before Revit combines forms.
            foreach(var cutter in spec.Parts.Where(p=>p.IsVoid))
            {
                foreach(var existing in preservedSolids)
                    if(BooleanOperationsUtils.ExecuteBooleanOperation(solids[cutter.Name],existing.Value,BooleanOperationsType.Intersect).Volume>1e-10)
                        throw new InvalidOperationException("Void would affect an unrequested source component: "+cutter.Name);
                foreach(var target in spec.Parts.Where(p=>!p.IsVoid))
                {
                    double overlap=BooleanOperationsUtils.ExecuteBooleanOperation(solids[cutter.Name],solids[target.Name],BooleanOperationsType.Intersect).Volume;
                    bool declared=cutter.CutTargets.Contains(target.Name,StringComparer.OrdinalIgnoreCase);
                    if(declared && overlap<=1e-10) throw new InvalidOperationException("Void misses declared target: "+cutter.Name+" -> "+target.Name);
                    if(!declared && overlap>1e-10) throw new InvalidOperationException("Void intersects undeclared target: "+cutter.Name+" -> "+target.Name);
                }
            }
            // Measure cutters as solids first; void geometry is not consistently exposed by Revit.
            // Change native Solid/Void only after capturing independent solid copies.
            foreach(var cutter in spec.Parts.Where(p=>p.IsVoid))
            {
                var form=forms[cutter.Name];
                var cutting=form.get_Parameter(BuiltInParameter.ELEMENT_IS_CUTTING);
                if(cutting==null || cutting.IsReadOnly || !cutting.Set(1)) throw new InvalidOperationException("Cannot create void: "+cutter.Name);
            }
            doc.Regenerate();
            foreach(var cutter in spec.Parts.Where(p=>p.IsVoid))
                if(forms[cutter.Name].IsSolid) throw new InvalidOperationException("Form is still solid: "+cutter.Name);
            var result=new List<FamilyGeometryEvidence>();
            var remaining=new HashSet<string>(forms.Keys,StringComparer.OrdinalIgnoreCase);
            while(remaining.Count>0)
            {
                var component=new HashSet<string>(StringComparer.OrdinalIgnoreCase) { remaining.First() };
                bool changed;
                do
                {
                    changed=false;
                    foreach(var p in spec.Parts.Where(p=>p.IsVoid))
                        if(component.Contains(p.Name) || p.CutTargets.Any(component.Contains))
                        {
                            changed|=component.Add(p.Name);
                            foreach(var name in p.CutTargets) changed|=component.Add(name);
                        }
                } while(changed);
                remaining.ExceptWith(component);
                if(component.Count==1) { result.Add(identities.Single(e=>component.Contains(e.Part))); continue; }
                var solidNames=component.Where(n=>!spec.Parts.Single(p=>string.Equals(p.Name,n,StringComparison.OrdinalIgnoreCase)).IsVoid).ToList();
                Solid expected=solids[solidNames[0]];
                foreach(var n in solidNames.Skip(1)) expected=BooleanOperationsUtils.ExecuteBooleanOperation(expected,solids[n],BooleanOperationsType.Union);
                double before=expected.Volume;
                foreach(var n in component.Except(solidNames,StringComparer.OrdinalIgnoreCase))
                    expected=BooleanOperationsUtils.ExecuteBooleanOperation(expected,solids[n],BooleanOperationsType.Difference);
                if(expected.Volume<=1e-10 || before-expected.Volume<=1e-10) throw new InvalidOperationException("Cut removes all geometry or makes no change.");
                var members=new CombinableElementArray();
                foreach(var n in component) members.Append(forms[n]);
                var combination=doc.CombineElements(members);
                doc.Regenerate();
                var evidence=MeasureFamilyElement(combination,string.Join("+",component.OrderBy(n=>n)),false);
                double volume=expected.Volume*Math.Pow(304.8,3);
                if(Math.Abs(evidence.VolumeMm3-volume)>Math.Max(0.1,volume*0.001)) throw new InvalidOperationException("Native void cut volume differs from boolean reference: actual="+evidence.VolumeMm3+" expected="+volume);
                result.Add(evidence);
            }
            VerifyFamilyGeometry(doc,preserved,new List<FamilyGeometryEvidence>());
            result.AddRange(preserved);
            return result;
        }

        private static void VerifyFamilyGeometry(Document doc, List<FamilyGeometryEvidence> measurements, List<FamilyGeometryEvidence> identities)
        {
            foreach(var identity in identities)
            {
                var form=doc.GetElement(identity.UniqueId) as GenericForm;
                if(form==null || form.GetType().Name!=identity.NativeType || form.IsSolid==identity.IsVoid ||
                    ReadFamilyPartName(form)!=identity.Part)
                    throw new InvalidOperationException("Saved native form identity differs: "+identity.Part);
            }
            foreach(var expected in measurements)
            {
                var element=doc.GetElement(expected.UniqueId);
                if(element==null || element.GetType().Name!=expected.NativeType) throw new InvalidOperationException("Saved form missing: "+expected.Part);
                var actual=MeasureFamilyElement(element,expected.Part,expected.IsVoid);
                if(actual.BoundsMm.Zip(expected.BoundsMm,(a,b)=>Math.Abs(a-b)).Any(v=>v>0.1) || Math.Abs(actual.VolumeMm3-expected.VolumeMm3)>Math.Max(0.1,expected.VolumeMm3*1e-6))
                    throw new InvalidOperationException("Saved geometry differs: "+expected.Part);
            }
        }
    }
}
