using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace RevitMCP.Core
{
    // Declarative, bounded geometry only. No paths, document IDs or executable source.
    internal static class ParametricCabinetSpec
    {
        internal static string Name(JToken t)
        {
            string s = t?.Type == JTokenType.String ? (string)t : null;
            if (s == null || !Regex.IsMatch(s, @"^[\p{L}\p{N}_-]{1,80}$") ||
                Regex.IsMatch(s, @"^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$", RegexOptions.IgnoreCase))
                throw new ArgumentException("Invalid name.");
            return s;
        }
        internal static double Number(JToken t, double lo = -10000, double hi = 10000)
        {
            if (t == null || (t.Type != JTokenType.Float && t.Type != JTokenType.Integer)) throw new ArgumentException("Number required.");
            double n = (double)t;
            if (double.IsNaN(n) || double.IsInfinity(n) || n < lo || n > hi) throw new ArgumentException("Number out of range.");
            return n;
        }
        static JArray Rows(JObject o, string key, int min, int max)
        {
            var a = o[key] as JArray;
            if (a == null || a.Count < min || a.Count > max || a.Any(x => !(x is JObject))) throw new ArgumentException("Invalid " + key);
            return a;
        }
        static void Keys(JObject o, params string[] names)
        {
            if (o.Properties().Any(p => !names.Contains(p.Name))) throw new ArgumentException("Unknown property.");
        }
        internal static JArray Validate(JObject input)
        {
            Keys(input, "jobs");
            var jobs = Rows(input, "jobs", 1, 3);
            var fileNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (JObject j in jobs)
            {
                Keys(j, "name", "parameters", "derivedParameters", "planes", "dimensions", "parts", "ports", "checks", "labels", "material");
                if (j["material"] != null) Name(j["material"]);
                if (!fileNames.Add(Name(j["name"]))) throw new ArgumentException("Duplicate output name.");
                var parameters = new HashSet<string>();
                foreach (JObject p in Rows(j, "parameters", 3, 16))
                {
                    Keys(p, "name", "valueMm");
                    if (!parameters.Add(Name(p["name"]))) throw new ArgumentException("Duplicate parameter.");
                    Number(p["valueMm"], 0.1);
                }
                var allParameters = new HashSet<string>(parameters);
                if (j["derivedParameters"] != null)
                    foreach (JObject p in Rows(j, "derivedParameters", 0, 4))
                    {
                        Keys(p, "name", "total", "subtract");
                        if (!allParameters.Add(Name(p["name"])) || !parameters.Contains(Name(p["total"])) || !parameters.Contains(Name(p["subtract"]))) throw new ArgumentException("Invalid derived parameter.");
                    }
                var planes = new Dictionary<string, JObject>();
                foreach (JObject p in Rows(j, "planes", 6, 160))
                {
                    Keys(p, "name", "axis", "mm", "pinned");
                    string name = Name(p["name"]);
                    if (planes.ContainsKey(name)) throw new ArgumentException("Duplicate plane.");
                    if (p["axis"]?.Type != JTokenType.Integer) throw new ArgumentException("Integer axis required.");
                    Number(p["axis"], 0, 2); Number(p["mm"]);
                    if (p["pinned"] != null && p["pinned"].Type != JTokenType.Boolean) throw new ArgumentException("Boolean required.");
                    planes.Add(name, p);
                }
                foreach (JObject dim in Rows(j, "dimensions", 3, 200))
                {
                    Keys(dim, "refs", "parameter");
                    var refs = dim["refs"] as JArray;
                    if (refs == null || (refs.Count != 2 && refs.Count != 3) || refs.Select(Name).Distinct().Count() != refs.Count || refs.Any(r => !planes.ContainsKey(Name(r)))) throw new ArgumentException("Invalid dimension references.");
                    if (refs.Select(r => (int)planes[Name(r)]["axis"]).Distinct().Count() != 1) throw new ArgumentException("Dimension axes differ.");
                    if (refs.Select(r => (double)planes[Name(r)]["mm"]).Distinct().Count() != refs.Count) throw new ArgumentException("Coincident dimension planes.");
                    if (dim["parameter"] != null && (refs.Count != 2 || !parameters.Contains(Name(dim["parameter"])))) throw new ArgumentException("Unknown dimension parameter.");
                    double first = (double)planes[Name(refs[0])]["mm"], lastCoordinate = (double)planes[Name(refs.Last)]["mm"];
                    if (refs.Count == 3 && Math.Abs(2 * (double)planes[Name(refs[1])]["mm"] - first - lastCoordinate) > .001) throw new ArgumentException("Unequal baseline equality dimension.");
                    if (dim["parameter"] != null)
                    {
                        double value = (double)((JArray)j["parameters"]).Single(p => Name(p["name"]) == Name(dim["parameter"]))["valueMm"];
                        if (Math.Abs(Math.Abs(lastCoordinate - first) - value) > .001) throw new ArgumentException("Baseline dimension label disagrees with planes.");
                    }
                }
                var labelNames = new HashSet<string>();
                foreach (JObject label in j["labels"] == null ? new JArray() : Rows(j, "labels", 0, 24))
                {
                    Keys(label, "parameter", "text", "frontPlane", "zPlane", "zOffsetMm", "fontMm", "depthMm");
                    string name = Name(label["parameter"]);
                    if (!labelNames.Add(name) || allParameters.Contains(name)) throw new ArgumentException("Duplicate label parameter.");
                    string value = label["text"]?.Type == JTokenType.String ? (string)label["text"] : null;
                    if (string.IsNullOrWhiteSpace(value) || value.Length > 80 || value.Any(char.IsControl)) throw new ArgumentException("Invalid label text.");
                    string frontName = Name(label["frontPlane"]), zName = Name(label["zPlane"]);
                    if (!planes.ContainsKey(frontName) || (int)planes[frontName]["axis"] != 1 || !planes.ContainsKey(zName) || (int)planes[zName]["axis"] != 2) throw new ArgumentException("Invalid label host planes.");
                    Number(label["zOffsetMm"], -10000, 10000);
                    Number(label["fontMm"], 5, 100); Number(label["depthMm"], .1, 5);
                }
                var parts = new HashSet<string>();
                foreach (JObject p in Rows(j, "parts", 1, 64))
                {
                    Keys(p, "name", "planes", "hidden");
                    if (!parts.Add(Name(p["name"]))) throw new ArgumentException("Duplicate part.");
                    var refs = p["planes"] as JArray;
                    if (refs == null || refs.Count != 6 || refs.Any(r => !planes.ContainsKey(Name(r)))) throw new ArgumentException("Six part planes required.");
                    for (int axis = 0; axis < 3; axis++)
                        if ((int)planes[Name(refs[axis])]["axis"] != axis || (int)planes[Name(refs[axis + 3])]["axis"] != axis ||
                            (double)planes[Name(refs[axis + 3])]["mm"] - (double)planes[Name(refs[axis])]["mm"] < 0.1) throw new ArgumentException("Invalid box extent.");
                    if (p["hidden"] != null && p["hidden"].Type != JTokenType.Boolean) throw new ArgumentException("Boolean required.");
                }
                var ports = new HashSet<string>();
                foreach (JObject p in Rows(j, "ports", 0, 32))
                {
                    Keys(p, "name", "part", "face", "diameterMm");
                    if (!ports.Add(Name(p["name"])) || !parts.Contains(Name(p["part"]))) throw new ArgumentException("Invalid port identity.");
                    if (p["face"]?.Type != JTokenType.Integer) throw new ArgumentException("Integer face required.");
                    Number(p["face"], 0, 5); Number(p["diameterMm"], 1, 500);
                }
                foreach (JObject check in Rows(j, "checks", 4, 12))
                {
                    Keys(check, "values", "bounds", "ports");
                    var values = check["values"] as JObject;
                    var bounds = check["bounds"] as JObject;
                    var expectedPorts = check["ports"] as JObject;
                    if (values == null || values.Count != parameters.Count || values.Properties().Any(p => !parameters.Contains(p.Name))) throw new ArgumentException("Each check must set every parameter.");
                    foreach (var p in values.Properties()) Number(p.Value, 0.1);
                    if (bounds == null || bounds.Count != parts.Count || bounds.Properties().Any(p => !parts.Contains(p.Name))) throw new ArgumentException("Each check must cover all parts.");
                    if (expectedPorts == null || expectedPorts.Count != ports.Count || expectedPorts.Properties().Any(p => !ports.Contains(p.Name))) throw new ArgumentException("Each check must cover all ports.");
                    foreach (var p in bounds.Properties().Concat(expectedPorts.Properties()))
                    {
                        var a = p.Value as JArray;
                        if (a == null || a.Count != (parts.Contains(p.Name) && bounds.Property(p.Name) == p ? 6 : 3)) throw new ArgumentException("Invalid expected geometry.");
                        foreach (var n in a) Number(n);
                    }
                    foreach (var p in bounds.Properties())
                        for (int axis = 0; axis < 3; axis++)
                            if ((double)p.Value[axis + 3] - (double)p.Value[axis] < .1) throw new ArgumentException("Invalid expected box extent.");
                    foreach (JObject p in (JArray)j["derivedParameters"] ?? new JArray())
                        if ((double)values[Name(p["total"])] - (double)values[Name(p["subtract"])] <= 0) throw new ArgumentException("Derived length must stay positive during flex.");
                }
                var last = (JObject)((JObject)((JArray)j["checks"]).Last)["values"];
                foreach (JObject p in (JArray)j["parameters"])
                    if ((double)last[Name(p["name"])] != (double)p["valueMm"]) throw new ArgumentException("Last check must restore baseline.");
                var baseline = (JObject)((JArray)j["checks"]).Last;
                foreach (JObject p in (JArray)j["parts"])
                    for (int i = 0; i < 6; i++)
                        if (Math.Abs((double)baseline["bounds"][Name(p["name"])][i] - (double)planes[Name(p["planes"][i])]["mm"]) > .001) throw new ArgumentException("Baseline expected geometry disagrees with part planes.");
                foreach (JObject p in (JArray)j["ports"])
                {
                    var bounds = baseline["bounds"][Name(p["part"])]; int side = (int)p["face"];
                    for (int a = 0; a < 3; a++)
                    {
                        double expected = a == side % 3 ? (double)bounds[side] : ((double)bounds[a] + (double)bounds[a + 3]) / 2;
                        if (Math.Abs(expected - (double)baseline["ports"][Name(p["name"])][a]) > .001) throw new ArgumentException("Baseline port is not centered on its host face.");
                    }
                }
            }
            return jobs;
        }
    }
}
