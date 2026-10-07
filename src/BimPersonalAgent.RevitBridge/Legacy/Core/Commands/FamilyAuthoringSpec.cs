using System;
using System.Linq;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;
namespace RevitMCP.Core
{
    internal sealed class FamilyPart
    {
        public string Name, Kind;
        public double X,Y,Z,Width,Depth,Height;
        public byte R,G,B;
        public bool IsVoid;
        public double[] Rotation;
        public double StartAngle, EndAngle;
        public List<List<FamilyCurveSpec>> Profile;
        public List<FamilyCurveSpec> Path;
        public List<string> CutTargets = new List<string>();
    }
    internal sealed class FamilyAuthoringSpec
    {
        public string Name;
        public string SourcePath, TemplateName;
        public List<FamilyPart> Parts = new List<FamilyPart>();
        public Dictionary<string,string> Metadata = new Dictionary<string,string>();
        public static FamilyAuthoringSpec Parse(JObject input)
        {
            var s = new FamilyAuthoringSpec { Name=SafeName(input.Value<string>("name")) };
            s.SourcePath = input.Value<string>("sourcePath");
            s.TemplateName = input.Value<string>("templateName");
            if (!string.IsNullOrEmpty(s.SourcePath) && (!System.IO.Path.IsPathRooted(s.SourcePath) || !s.SourcePath.EndsWith(".rfa", StringComparison.OrdinalIgnoreCase)))
                throw new ArgumentException("sourcePath must be an absolute RFA path.");
            if (!string.IsNullOrEmpty(s.SourcePath) && !string.IsNullOrEmpty(s.TemplateName))
                throw new ArgumentException("Choose sourcePath or templateName, not both.");
            if (!string.IsNullOrEmpty(s.TemplateName) && (System.IO.Path.GetFileName(s.TemplateName)!=s.TemplateName || s.TemplateName.Contains(":") || !s.TemplateName.EndsWith(".rft", StringComparison.OrdinalIgnoreCase)))
                throw new ArgumentException("templateName must name an installed English RFT file, without a path.");
            var parts=input["parts"] as JArray;
            if(parts==null || parts.Count<1 || parts.Count>64) throw new ArgumentException("Expected 1-64 parts.");
            var names=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach(JObject p in parts)
            {
                var part=new FamilyPart {Name=SafeName(p.Value<string>("name")),Kind=p.Value<string>("kind")};
                if(!names.Add(part.Name)) throw new ArgumentException("Duplicate part name.");
                FamilyGeometrySpec.Parse(part,p);
                part.X=Number(p,"xMm",-10000,10000);part.Y=Number(p,"yMm",-10000,10000);part.Z=Number(p,"zMm",-10000,10000);
                if(new[]{"r","g","b"}.Any(k=>p[k]?.Type!=JTokenType.Integer)) throw new ArgumentException("Colors must be integers.");
                part.R=(byte)Number(p,"r",0,255);part.G=(byte)Number(p,"g",0,255);part.B=(byte)Number(p,"b",0,255);
                s.Parts.Add(part);
            }
            FamilyGeometrySpec.ValidateTargets(s.Parts);
            var metadata=input["metadata"] as JObject;
            if(metadata==null || metadata.Count>32) throw new ArgumentException("Expected metadata object, at most 32 entries.");
            foreach(var p in metadata.Properties())
            {
                if(p.Value.Type!=JTokenType.String || p.Value.ToString().Length>2000) throw new ArgumentException("Metadata must be strings up to 2000 characters.");
                s.Metadata.Add(SafeName(p.Name),p.Value.ToString());
            }
            return s;
        }
        private static string SafeName(string name)
        {
            if(name==null || !Regex.IsMatch(name,@"\A[A-Za-z][A-Za-z0-9_-]{0,79}\z") ||
                Regex.IsMatch(name,@"\A(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\z",RegexOptions.IgnoreCase))
                throw new ArgumentException("Names must be safe ASCII identifiers (1-80 characters), not device names.");
            return name;
        }
        private static double Number(JObject p,string key,double min,double max)
        {
            if(p[key]==null || (p[key].Type!=JTokenType.Integer && p[key].Type!=JTokenType.Float)) throw new ArgumentException("Missing numeric "+key);
            double v=p.Value<double>(key);
            if(double.IsNaN(v)||double.IsInfinity(v)||v<min||v>max) throw new ArgumentException("Out of range "+key);
            return v;
        }
    }
}
