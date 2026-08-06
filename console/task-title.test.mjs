import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("./app.js", import.meta.url), "utf8");
const functionStart = appSource.indexOf("function translateTaskTitle");
const functionEnd = appSource.indexOf("\nfunction translateEventMessage", functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart, "translateTaskTitle must remain testable");
const translateTaskTitle = Function(`${appSource.slice(functionStart, functionEnd)}; return translateTaskTitle;`)();

test("keeps an unknown English task title instead of replacing it with a generic BIM label", () => {
  assert.equal(translateTaskTitle("Apply a custom active-view color to selected pipes"), undefined);
});

test("keeps reliable bilingual translations for known task titles", () => {
  assert.equal(translateTaskTitle("Get Project Info"), "讀取專案資訊");
  assert.equal(
    translateTaskTitle("Set the exact 20 currently selected sanitary pipes and fittings to semi-transparent green in the active view for a reversible smoke test"),
    "將目前選取的 20 個污水管與管配件，在目前視圖設為半透明綠色，進行可還原測試",
  );
});
