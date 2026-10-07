using System;
using System.IO;
using Newtonsoft.Json.Linq;
using RevitMCP.Core;
class Program
{
    static int Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--validate-directory")
        {
            int validated = 0;
            foreach (string path in Directory.GetFiles(args[1], "*.json"))
            {
                var input = JToken.Parse(File.ReadAllText(path)) as JObject;
                if (input == null) continue;
                if (input["jobs"] == null) continue;
                try { ParametricCabinetSpec.Validate(input); }
                catch (Exception ex) { Console.WriteLine(Path.GetFileName(path) + ": " + ex.Message); return 1; }
                validated++;
            }
            Console.WriteLine("Production declarations validated: " + validated);
            return 0;
        }
        var sample = JObject.Parse(File.ReadAllText(args[0]));
        ParametricCabinetSpec.Validate(sample);
        int count = 1;
        Action<Action<JObject>> reject = change => {
            var copy = (JObject)sample.DeepClone(); change(copy);
            try { ParametricCabinetSpec.Validate(copy); }
            catch (ArgumentException) { count++; return; }
            throw new Exception("Invalid input accepted.");
        };
        foreach (var name in new[] { "../bad", "CON", "LPT1", "bad.rfa", "x/y", "" }) reject(x => x["jobs"][0]["name"] = name);
        reject(x => x["outputPath"] = "C:/bad");
        reject(x => x["jobs"][0]["source"] = "code");
        reject(x => x["jobs"][0]["parameters"][0]["valueMm"] = "650");
        reject(x => x["jobs"][0]["parameters"][0]["valueMm"] = double.NaN);
        reject(x => x["jobs"][0]["planes"][0]["axis"] = 0.5);
        reject(x => x["jobs"][0]["parts"][0]["planes"][0] = "missing");
        reject(x => x["jobs"][0]["parts"][0]["planes"][3] = x["jobs"][0]["parts"][0]["planes"][0].DeepClone());
        reject(x => x["jobs"][0]["checks"][0]["bounds"] = new JObject());
        reject(x => x["jobs"][0]["checks"][0]["ports"] = new JObject());
        reject(x => ((JArray)x["jobs"]).Add(x["jobs"][0].DeepClone()));
        reject(x => x["jobs"] = new JArray());
        reject(x => x["jobs"][0]["parameters"][0]["valueMm"] = 651);
        reject(x => x["jobs"][0]["derivedParameters"][0]["subtract"] = "missing");
        reject(x => x["jobs"][0]["derivedParameters"][0]["subtract"] = x["jobs"][0]["derivedParameters"][0]["total"].DeepClone());
        reject(x => x["jobs"][0]["checks"][0]["bounds"]["Back"][3] = -500);
        reject(x => ((JArray)x["jobs"][0]["checks"]).Last["bounds"]["Back"][3] = 400);
        reject(x => ((JArray)x["jobs"][0]["checks"]).Last["ports"]["FL05_1RA2"][2] = 2100);
        if (sample["jobs"][0]["labels"] != null)
        {
            reject(x => x["jobs"][0]["labels"][0]["text"] = "");
            reject(x => x["jobs"][0]["labels"][0]["text"] = "line\nbreak");
            reject(x => x["jobs"][0]["labels"][0]["fontMm"] = 0);
            reject(x => x["jobs"][0]["labels"][0]["frontPlane"] = "ZT");
            reject(x => x["jobs"][0]["labels"][0]["zPlane"] = "missing");
            reject(x => x["jobs"][0]["labels"][0]["parameter"] = x["jobs"][0]["parameters"][0]["name"].DeepClone());
            reject(x => ((JArray)x["jobs"][0]["labels"]).Add(x["jobs"][0]["labels"][0].DeepClone()));
            reject(x => x["jobs"][0]["labels"][0]["source"] = "code");
            reject(x => x["jobs"][0]["material"] = "../material");
        }
        Console.WriteLine("Cabinet validation: " + count + " checks passed.");
        return 0;
    }
}
