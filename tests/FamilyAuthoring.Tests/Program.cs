using System;
using Newtonsoft.Json.Linq;
using RevitMCP.Core;
class Program
{
 static JObject Sample() => JObject.Parse(@"{'name':'BN168','metadata':{'Source':'PDF 115'},'parts':[{'name':'Body','kind':'box','xMm':0,'yMm':0,'zMm':-34,'widthMm':1185,'depthMm':22,'heightMm':34,'r':200,'g':200,'b':200}]}");
 static int Main()
 {
  int count=0;
  Action<Action<JObject>> reject=change=>{var x=Sample();change(x);try{FamilyAuthoringSpec.Parse(x);}catch(ArgumentException){count++;return;}throw new Exception("Invalid input accepted");};
  foreach(string name in new[]{"../bad","C:\\bad","CON","nul","COM1","LPT9","a.rfa",""}) reject(x=>x["name"]=name);
  foreach(double n in new[]{double.NaN,double.PositiveInfinity,-1,0,10001}) reject(x=>x["parts"][0]["heightMm"]=n);
  reject(x=>x["parts"][0]["kind"]="execute");
  reject(x=>((JArray)x["parts"]).Add(x["parts"][0].DeepClone()));
  reject(x=>x["parts"][0]["widthMm"]="1185");
  reject(x=>x["metadata"]["bad/path"]="x");
  reject(x=>x["metadata"]["Long"]=new string('a',2001));
  reject(x=>x["parts"]=new JArray());
  reject(x=>x["sourcePath"]="relative.rfa");
  reject(x=>x["sourcePath"]="C:/bad.rvt");
  reject(x=>x["templateName"]="../bad.rft");
  reject(x=>{x["sourcePath"]="C:/good.rfa";x["templateName"]="Metric Generic Model.rft";});
  var copy=Sample();copy["sourcePath"]="C:/good.rfa";FamilyAuthoringSpec.Parse(copy);
  var good=FamilyAuthoringSpec.Parse(Sample());
  if(good.Parts[0].Z!=-34||good.Parts[0].Width!=1185)throw new Exception("Dimensions altered");
  Func<string,JObject> shape=kind=>{
    var x=Sample(); var p=(JObject)x["parts"][0]; p["kind"]=kind;
    p["profile"]=JArray.Parse(@"[[{'start':[0,0],'end':[40,0]},{'start':[40,0],'end':[40,20]},{'start':[40,20],'end':[0,20]},{'start':[0,20],'end':[0,0]}]]");
    p.Remove("widthMm");p.Remove("depthMm");return x;
  };
  Action<JObject> accept=x=>{FamilyAuthoringSpec.Parse(x);count++;};
  Action<JObject> invalid=x=>{try{FamilyAuthoringSpec.Parse(x);}catch(ArgumentException){count++;return;}throw new Exception("Invalid advanced geometry accepted: "+x);};
  accept(shape("profileExtrusion"));accept(shape("revolution"));
  var sweep=shape("sweep");sweep["parts"][0]["path"]=JArray.Parse(@"[{'start':[0,0,0],'end':[0,0,100]}]");accept(sweep);
  var arc=shape("profileExtrusion");arc["parts"][0]["profile"]=JArray.Parse(@"[[{'start':[20,0],'end':[-20,0],'mid':[0,20]},{'start':[-20,0],'end':[20,0],'mid':[0,-20]}]]");accept(arc);
  var bad=shape("profileExtrusion");bad["parts"][0]["profile"][0][0]["start"][0]=1;invalid(bad);
  bad=shape("profileExtrusion");bad["parts"][0]["profile"][0][0]["end"]=new JArray(0,0);invalid(bad);
  bad=shape("profileExtrusion");bad["parts"][0]["profile"][0][0]["start"]=new JArray(0,0,0);invalid(bad);
  bad=shape("profileExtrusion");bad["parts"][0]["profile"][0][0]["mid"]=new JArray(20,0);invalid(bad);
  bad=shape("revolution");bad["parts"][0]["startAngleDeg"]=360;invalid(bad);
  bad=shape("revolution");bad["parts"][0]["profile"][0][0]["start"][0]=-1;invalid(bad);
  bad=shape("sweep");invalid(bad);
  bad=(JObject)sweep.DeepClone();bad["parts"][0]["path"][0]["end"]=new JArray(0,0,0);invalid(bad);
  bad=Sample();bad["parts"][0]["rotateXDeg"]=double.NaN;invalid(bad);
  bad=Sample();bad["parts"][0]["r"]=20.5;invalid(bad);
  bad=Sample();bad["parts"][0]["isVoid"]="true";invalid(bad);
  bad=Sample();bad["parts"][0]["isVoid"]=true;invalid(bad);
  var cut=Sample();var cutter=(JObject)cut["parts"][0].DeepClone();cutter["name"]="Cut";cutter["isVoid"]=true;cutter["cutTargets"]=new JArray("Body");((JArray)cut["parts"]).Add(cutter);accept(cut);
  bad=(JObject)cut.DeepClone();bad["parts"][1]["cutTargets"]=new JArray("Missing");invalid(bad);
  bad=(JObject)cut.DeepClone();bad["parts"][1]["cutTargets"]=new JArray("Cut");invalid(bad);
  bad=(JObject)cut.DeepClone();bad["parts"][1]["cutTargets"]=new JArray("Body","body");invalid(bad);
  bad=Sample();bad["parts"][0]["cutTargets"]=new JArray("Body");invalid(bad);
  bad=Sample();bad["parts"][0]["startAngleDeg"]=0;invalid(bad);
  bad=Sample();bad["parts"][0]["profile"]=new JArray();invalid(bad);
  bad=shape("profileExtrusion");bad["parts"][0]["path"]=new JArray();invalid(bad);

  Console.WriteLine("Passed "+count+" rejection cases and valid signed-coordinate case.");return 0;
 }
}
