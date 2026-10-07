import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validateArguments } from "./validation.js";
import type { JsonSchema } from "./types.js";
const catalog = JSON.parse(readFileSync(new URL("./catalog/builtin-tools.json", import.meta.url), "utf8"));
const tool = catalog.find((x: {toolId:string}) => x.toolId === "builtin:create_lighting_family_file");
const sample = () => ({name:"BN168_Pilot",metadata:{Model:"BN168 14W",Source:"PDF 115"},parts:[{name:"Body",kind:"box",xMm:0,yMm:0,zMm:0,widthMm:1185,depthMm:22,heightMm:34,r:200,g:200,b:200}]});
test("family authoring accepts bounded geometry and is preserves original files",()=>{
 assert.equal(tool.risk,"reversibleMutation"); assert.equal(tool.status,"experimental");
 assert.doesNotThrow(()=>validateArguments(tool.inputSchema as JsonSchema,sample()));
});
test("family authoring rejects path injection and out-of-bounds geometry",()=>{
 for(const name of ["../escape","C:\\output","A.rfa","a/b"])
  assert.throws(()=>validateArguments(tool.inputSchema,{...sample(),name}));
 for(const heightMm of [0,-1,10001]) {
  const value=sample();value.parts[0].heightMm=heightMm;
  assert.throws(()=>validateArguments(tool.inputSchema,value));
 }
 assert.throws(()=>validateArguments(tool.inputSchema,{...sample(),outputPath:"C:/override.rfa"}));
 assert.throws(()=>validateArguments(tool.inputSchema,{...sample(),parts:Array(65).fill(sample().parts[0])}));
});

test("native family form schema covers profile, revolution, sweep and explicit voids",()=>{
 const loop=[{start:[0,0],end:[20,0]},{start:[20,0],end:[20,10]},{start:[20,10],end:[0,0]}];
 const body=sample().parts[0];
 const advanced=(kind:string)=>({name:"NativePilot",metadata:{},parts:[{name:"Form",kind,xMm:0,yMm:0,zMm:0,r:200,g:200,b:200,profile:[loop],heightMm:10}]});
 for(const id of ["builtin:create_family_file","builtin:create_lighting_family_file"]) {
  const schema=catalog.find((v:{toolId:string})=>v.toolId===id).inputSchema;
  for(const kind of ["profileExtrusion","revolution"]) assert.doesNotThrow(()=>validateArguments(schema,advanced(kind)));
  const sweep=advanced("sweep");
  assert.throws(()=>validateArguments(schema,sweep));
  assert.doesNotThrow(()=>validateArguments(schema,{...sweep,parts:[{...sweep.parts[0],path:[{start:[0,0,0],end:[0,0,100]}]}]}));
  assert.doesNotThrow(()=>validateArguments(schema,{...sample(),parts:[body,{...body,name:"Void",isVoid:true,cutTargets:["Body"]}]}));
  for(const extra of [{isVoid:true},{isVoid:false,cutTargets:["Body"]},{rotateZDeg:361},{profile:[loop]},{r:12.5}])
   assert.throws(()=>validateArguments(schema,{...sample(),parts:[{...body,...extra}]}));
  const missingHeight=advanced("profileExtrusion");
  const {heightMm,...withoutHeight}=missingHeight.parts[0];
  assert.throws(()=>validateArguments(schema,{...missingHeight,parts:[withoutHeight]}));
 }
});
