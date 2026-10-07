using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;

namespace RevitMCP.Core
{
    internal sealed class FamilyCurveSpec
    {
        public double[] Start, End, Mid;
    }

    internal static class FamilyGeometrySpec
    {
        internal static double Numeric(JObject p, string key, double min, double max, double? fallback = null)
        {
            if (p[key] == null && fallback.HasValue) return fallback.Value;
            if (p[key] == null || (p[key].Type != JTokenType.Integer && p[key].Type != JTokenType.Float))
                throw new ArgumentException("Missing numeric " + key);
            double value = p.Value<double>(key);
            if (double.IsNaN(value) || double.IsInfinity(value) || value < min || value > max)
                throw new ArgumentException("Out of range " + key);
            return value;
        }

        internal static void Parse(FamilyPart part, JObject p)
        {
            if (!new[] { "box", "cylinder", "profileExtrusion", "revolution", "sweep" }.Contains(part.Kind))
                throw new ArgumentException("Unsupported family form kind.");
            if (p["isVoid"] != null && p["isVoid"].Type != JTokenType.Boolean)
                throw new ArgumentException("isVoid must be boolean.");
            part.IsVoid = p.Value<bool?>("isVoid") ?? false;
            part.Rotation = new[] { Numeric(p,"rotateXDeg",-360,360,0), Numeric(p,"rotateYDeg",-360,360,0), Numeric(p,"rotateZDeg",-360,360,0) };
            if (part.Kind == "box" || part.Kind == "cylinder")
            {
                part.Width = Numeric(p,"widthMm",1,10000);
                part.Depth = Numeric(p,"depthMm",1,10000);
                part.Height = Numeric(p,"heightMm",1,10000);
                if (p["profile"] != null || p["path"] != null) throw new ArgumentException("Primitive cannot have profile/path.");
            }
            else
            {
                var loops = p["profile"] as JArray;
                if (loops == null || loops.Count < 1 || loops.Count > 16) throw new ArgumentException("Expected 1-16 profile loops.");
                part.Profile = loops.Select(loop => Curves(loop,2,true)).ToList();
                if (part.Kind == "profileExtrusion") part.Height = Numeric(p,"heightMm",1,10000);
                if (part.Kind == "revolution")
                {
                    part.StartAngle = Numeric(p,"startAngleDeg",0,360,0);
                    part.EndAngle = Numeric(p,"endAngleDeg",0,360,360);
                    if (part.EndAngle - part.StartAngle < 0.01) throw new ArgumentException("Revolution angle must be positive.");
                    if (part.Profile.SelectMany(l => l).Any(c => c.Start[0]<0 || c.End[0]<0 || (c.Mid != null && c.Mid[0]<0)))
                        throw new ArgumentException("Revolution radial coordinate must be nonnegative.");
                }
                if (part.Kind == "sweep") part.Path = Curves(p["path"],3,false);
                else if (p["path"] != null) throw new ArgumentException("Only sweep accepts path.");
            }
            if (part.Kind != "revolution" && (p["startAngleDeg"] != null || p["endAngleDeg"] != null))
                throw new ArgumentException("Only revolution accepts angles.");
            if (p["cutTargets"] != null)
            {
                var targets = p["cutTargets"] as JArray;
                if (targets == null || targets.Count < 1 || targets.Count > 64 || targets.Any(t => t.Type != JTokenType.String))
                    throw new ArgumentException("Invalid cutTargets.");
                part.CutTargets = targets.Values<string>().ToList();
                if (part.CutTargets.Distinct(StringComparer.OrdinalIgnoreCase).Count() != part.CutTargets.Count)
                    throw new ArgumentException("Duplicate cut target.");
            }
            if (part.IsVoid != (part.CutTargets.Count > 0))
                throw new ArgumentException("Every void requires explicit cutTargets; solids cannot declare cutTargets.");
        }

        internal static void ValidateTargets(List<FamilyPart> parts)
        {
            foreach (var p in parts.Where(v => v.IsVoid))
                foreach (string name in p.CutTargets)
                {
                    var target = parts.SingleOrDefault(v => string.Equals(v.Name,name,StringComparison.OrdinalIgnoreCase));
                    if (target == null || target.IsVoid) throw new ArgumentException("Cut target must be a solid in this request: " + name);
                }
        }

        private static double[] Point(JToken value, int dimension)
        {
            var a = value as JArray;
            if (a == null || a.Count != dimension) throw new ArgumentException("Invalid point dimension.");
            return a.Select(v => Numeric(new JObject { ["v"] = v.DeepClone() },"v",-10000,10000)).ToArray();
        }
        private static double Distance(double[] a, double[] b) => Math.Sqrt(a.Zip(b,(x,y)=>(x-y)*(x-y)).Sum());
        private static List<FamilyCurveSpec> Curves(JToken value, int dimension, bool closed)
        {
            var a = value as JArray;
            if (a == null || a.Count < (closed ? 2 : 1) || a.Count > 128) throw new ArgumentException("Invalid curve count.");
            var result = new List<FamilyCurveSpec>();
            foreach (var item in a)
            {
                var c = item as JObject;
                if (c == null || c.Properties().Any(p => p.Name != "start" && p.Name != "end" && p.Name != "mid"))
                    throw new ArgumentException("Curve accepts start, end and optional arc mid only.");
                var curve = new FamilyCurveSpec { Start=Point(c["start"],dimension), End=Point(c["end"],dimension), Mid=c["mid"]==null?null:Point(c["mid"],dimension) };
                if (Distance(curve.Start,curve.End)<0.1) throw new ArgumentException("Degenerate curve.");
                if (curve.Mid != null)
                {
                    double ab=Distance(curve.Start,curve.Mid), bc=Distance(curve.Mid,curve.End), ac=Distance(curve.Start,curve.End);
                    if (ab<0.1 || bc<0.1 || Math.Min(Math.Abs(ab+bc-ac),Math.Min(Math.Abs(ab+ac-bc),Math.Abs(bc+ac-ab)))<1e-6)
                        throw new ArgumentException("Arc points must be distinct and non-collinear.");
                }
                if (result.Count>0 && Distance(result.Last().End,curve.Start)>0.001) throw new ArgumentException("Disconnected curves.");
                result.Add(curve);
            }
            if (closed && Distance(result.Last().End,result[0].Start)>0.001) throw new ArgumentException("Open profile loop.");
            return result;
        }
    }
}
