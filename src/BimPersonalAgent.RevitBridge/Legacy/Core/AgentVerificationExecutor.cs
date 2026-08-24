using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Newtonsoft.Json.Linq;
using RevitMCP.Models;

namespace RevitMCP.Core
{
    internal sealed class AgentPlanStep
    {
        public string StepId { get; set; }
        public string ToolId { get; set; }
        public RevitCommandRequest Request { get; set; }
    }

    internal sealed class AgentVerificationCheckResult
    {
        public string Id { get; set; }
        public string Kind { get; set; }
        public string StepId { get; set; }
        public bool Passed { get; set; }
        public string Message { get; set; }
        public object Actual { get; set; }
        public long[] ElementIds { get; set; }
    }

    internal sealed class AgentVerificationSummary
    {
        public bool Passed { get; set; }
        public List<AgentVerificationCheckResult> Checks { get; set; }
    }

    public partial class CommandExecutor
    {
        private object ExecuteVerifiedAgentPlan(
            Document document,
            UIDocument uiDocument,
            string documentFingerprint,
            List<AgentPlanStep> steps,
            JArray verificationChecks,
            string runId,
            int attempt)
        {
            ValidateDynamicPlanSteps(steps, document, uiDocument);
            var results = new List<object>();
            using (var group = new TransactionGroup(document, "BIM Personal Agent plan"))
            {
                group.Start();
                try
                {
                    ExecuteValidatedSteps(steps, documentFingerprint, results);
                    AgentVerificationSummary verification = RunVerificationChecks(document, verificationChecks);
                    if (verificationChecks.Count > 0 && !verification.Passed)
                    {
                        group.RollBack();
                        return CreatePlanResult(runId, attempt, true, true, results, verification, true);
                    }

                    group.Assimilate();
                    return CreatePlanResult(runId, attempt, true, false, results, verification, verificationChecks.Count > 0);
                }
                catch
                {
                    if (group.GetStatus() == TransactionStatus.Started) group.RollBack();
                    throw;
                }
            }
        }

        private void ExecuteValidatedSteps(List<AgentPlanStep> steps, string documentFingerprint, List<object> results)
        {
            foreach (AgentPlanStep step in steps)
            {
                Document activeDocument = _uiApp.ActiveUIDocument?.Document;
                if (activeDocument == null ||
                    !string.Equals(ComputeProjectFingerprint(activeDocument), documentFingerprint, StringComparison.Ordinal))
                {
                    throw new InvalidOperationException("The active Revit document changed during the Agent plan.");
                }

                RevitCommandResponse response = ExecuteCommand(step.Request);
                if (!response.Success) throw new InvalidOperationException(response.Error ?? "Agent plan step failed.");
                results.Add(new { step.StepId, step.ToolId, CommandName = step.Request.CommandName, response.Data });
            }
        }

        private void ValidateDynamicPlanSteps(List<AgentPlanStep> steps, Document document, UIDocument uiDocument)
        {
            foreach (AgentPlanStep step in steps.Where(item =>
                item.Request.CommandName.Equals("execute_dynamic_csharp", StringComparison.OrdinalIgnoreCase)))
            {
                JObject parameters = step.Request.Parameters as JObject ?? new JObject();
                DynamicCompilationResult compiled = DynamicCSharpRuntime.Compile(parameters.Value<string>("source"));
                if (compiled.UsesDestructiveApi) throw new InvalidOperationException("Destructive Dynamic C# cannot run inside an Agent plan.");
                var context = new DynamicRevitContext(
                    document,
                    document.ActiveView,
                    uiDocument.Selection.GetElementIds().Select(id => id.Value).ToArray(),
                    parameters["inputs"] as JObject ?? new JObject());
                DynamicCommandMetadata metadata = compiled.Command.Describe(context) ??
                    throw new InvalidOperationException("Describe() returned null metadata.");
                if (metadata.IsDestructive) throw new InvalidOperationException("Destructive Dynamic C# cannot run inside an Agent plan.");
            }
        }

        private static object CreatePlanResult(
            string runId,
            int attempt,
            bool atomic,
            bool rolledBack,
            List<object> results,
            AgentVerificationSummary verification,
            bool verified)
        {
            string verdict = verified ? (verification.Passed ? "passed" : "failed") : "unverified";
            return new
            {
                RunId = runId,
                Attempt = attempt,
                Phase = verified ? "verifying" : "executing",
                Verdict = verdict,
                Atomic = atomic,
                RolledBack = rolledBack,
                ExecutedSteps = results.Count,
                TransactionName = atomic ? "BIM Personal Agent plan" : null,
                Results = results,
                Verification = verification,
                ErrorCode = verified && !verification.Passed ? "VERIFICATION_FAILED" : null
            };
        }

        private AgentVerificationSummary RunVerificationChecks(Document document, JArray checks)
        {
            var results = new List<AgentVerificationCheckResult>();
            foreach (JToken token in checks)
            {
                JObject check = token as JObject ?? throw new InvalidOperationException("Every verification check must be an object.");
                results.Add(RunVerificationCheck(document, check));
            }
            return new AgentVerificationSummary { Passed = results.All(result => result.Passed), Checks = results };
        }

        private AgentVerificationCheckResult RunVerificationCheck(Document document, JObject check)
        {
            string id = check.Value<string>("id") ?? throw new InvalidOperationException("Verification check id is required.");
            string kind = check.Value<string>("kind") ?? throw new InvalidOperationException("Verification check kind is required.");
            string stepId = check.Value<string>("stepId");
            try
            {
                switch (kind)
                {
                    case "elementExists": return VerifyElementExists(document, id, stepId, check);
                    case "elementCount": return VerifyElementCount(document, id, stepId, check);
                    case "parameterEquals": return VerifyParameterEquals(document, id, stepId, check);
                    case "mepConnectivity": return VerifyMepConnectivity(document, id, stepId, check);
                    case "clearance": return VerifyClearance(document, id, stepId, check);
                    case "viewPlacement": return VerifyViewPlacement(document, id, stepId, check);
                    case "quantity": return VerifyQuantity(document, id, stepId, check);
                    case "evidence": return VerifyEvidence(document, id, stepId, check);
                    default: throw new InvalidOperationException("Unsupported verification kind: " + kind);
                }
            }
            catch (Exception ex)
            {
                return VerificationResult(id, kind, stepId, false, ex.Message, null, ReadIds(check["elementIds"]));
            }
        }

        private AgentVerificationCheckResult VerifyElementExists(Document document, string id, string stepId, JObject check)
        {
            long[] ids = ReadIds(check["elementIds"]);
            bool shouldExist = check.Value<bool?>("shouldExist") ?? true;
            long[] existing = ids.Where(value => document.GetElement(new ElementId(value)) != null).ToArray();
            bool passed = ids.Length > 0 && (shouldExist ? existing.Length == ids.Length : existing.Length == 0);
            return VerificationResult(id, "elementExists", stepId, passed, passed ? "Element existence matched." : "Element existence did not match.", new { Existing = existing.Length, Requested = ids.Length }, ids);
        }

        private AgentVerificationCheckResult VerifyElementCount(Document document, string id, string stepId, JObject check)
        {
            List<Element> elements = GetScopedElements(document, check);
            int count = elements.Count;
            int? exact = check.Value<int?>("exact");
            int? minimum = check.Value<int?>("min");
            int? maximum = check.Value<int?>("max");
            if (!exact.HasValue && !minimum.HasValue && !maximum.HasValue)
            {
                throw new InvalidOperationException("elementCount requires exact, min, or max.");
            }
            bool passed = (!exact.HasValue || count == exact.Value) && (!minimum.HasValue || count >= minimum.Value) && (!maximum.HasValue || count <= maximum.Value);
            return VerificationResult(id, "elementCount", stepId, passed, passed ? "Element count matched." : "Element count was outside the expected range.", new { Count = count, Exact = exact, Min = minimum, Max = maximum }, elements.Select(item => item.Id.Value).ToArray());
        }

        private AgentVerificationCheckResult VerifyParameterEquals(Document document, string id, string stepId, JObject check)
        {
            string parameterName = check.Value<string>("parameterName") ?? throw new InvalidOperationException("parameterName is required.");
            JToken expected = check["expected"] ?? throw new InvalidOperationException("expected is required.");
            double tolerance = check.Value<double?>("tolerance") ?? 0.000001;
            List<Element> elements = GetScopedElements(document, check);
            var mismatched = new List<long>();
            foreach (Element element in elements)
            {
                Parameter parameter = element.LookupParameter(parameterName);
                if (parameter == null || !ParameterMatches(parameter, expected, tolerance)) mismatched.Add(element.Id.Value);
            }
            return VerificationResult(id, "parameterEquals", stepId, mismatched.Count == 0 && elements.Count > 0,
                mismatched.Count == 0 ? "Parameter values matched." : "One or more parameter values did not match.",
                new { Checked = elements.Count, Mismatched = mismatched.Count }, mismatched.ToArray());
        }

        private AgentVerificationCheckResult VerifyMepConnectivity(Document document, string id, string stepId, JObject check)
        {
            List<Element> elements = GetScopedElements(document, check);
            var disconnected = new List<long>();
            foreach (Element element in elements)
            {
                ConnectorManager manager = GetConnectorManager(element);
                bool connected = manager != null && manager.Connectors.Cast<Connector>().Any(connector => connector.IsConnected);
                if (!connected) disconnected.Add(element.Id.Value);
            }
            return VerificationResult(id, "mepConnectivity", stepId, disconnected.Count == 0 && elements.Count > 0,
                disconnected.Count == 0 ? "MEP connectivity matched." : "Disconnected MEP elements were found.",
                new { Checked = elements.Count, Disconnected = disconnected.Count }, disconnected.ToArray());
        }

        private AgentVerificationCheckResult VerifyClearance(Document document, string id, string stepId, JObject check)
        {
            JArray pairs = check["pairs"] as JArray ?? throw new InvalidOperationException("clearance pairs are required.");
            if (pairs.Count < 1) throw new InvalidOperationException("clearance requires at least one element pair.");
            double minimum = check.Value<double?>("minimumDistance") ?? throw new InvalidOperationException("minimumDistance is required.");
            if (minimum <= 0.0) throw new InvalidOperationException("minimumDistance must be greater than zero.");
            var failed = new List<long>();
            double smallest = double.MaxValue;
            foreach (JObject pair in pairs.OfType<JObject>())
            {
                long firstId = pair.Value<long>("a");
                long secondId = pair.Value<long>("b");
                Element first = document.GetElement(new ElementId(firstId));
                Element second = document.GetElement(new ElementId(secondId));
                if (first == null || second == null) throw new InvalidOperationException("Clearance pair contains a missing element.");
                double distance = BoundingBoxDistance(first.get_BoundingBox(null), second.get_BoundingBox(null));
                smallest = Math.Min(smallest, distance);
                if (distance < minimum) { failed.Add(firstId); failed.Add(secondId); }
            }
            return VerificationResult(id, "clearance", stepId, failed.Count == 0,
                failed.Count == 0 ? "Clearance matched." : "One or more clearance pairs failed.",
                new { PairCount = pairs.Count, MinimumRequired = minimum, Smallest = smallest == double.MaxValue ? (double?)null : smallest }, failed.Distinct().ToArray());
        }

        private AgentVerificationCheckResult VerifyViewPlacement(Document document, string id, string stepId, JObject check)
        {
            long sheetId = check.Value<long?>("sheetId") ?? throw new InvalidOperationException("sheetId is required.");
            long[] viewIds = ReadIds(check["viewIds"]);
            if (!(document.GetElement(new ElementId(sheetId)) is ViewSheet)) throw new InvalidOperationException("sheetId must identify an existing sheet.");
            if (viewIds.Length < 1) throw new InvalidOperationException("viewPlacement requires at least one viewId.");
            var placed = new HashSet<long>(new FilteredElementCollector(document, new ElementId(sheetId))
                .OfClass(typeof(Viewport)).Cast<Viewport>().Select(item => item.ViewId.Value));
            foreach (ScheduleSheetInstance schedule in new FilteredElementCollector(document, new ElementId(sheetId)).OfClass(typeof(ScheduleSheetInstance)).Cast<ScheduleSheetInstance>())
            {
                placed.Add(schedule.ScheduleId.Value);
            }
            long[] missing = viewIds.Where(value => !placed.Contains(value)).ToArray();
            return VerificationResult(id, "viewPlacement", stepId, missing.Length == 0,
                missing.Length == 0 ? "Views are placed on the sheet." : "One or more views are not placed on the sheet.",
                new { Requested = viewIds.Length, Missing = missing.Length }, missing);
        }

        private AgentVerificationCheckResult VerifyQuantity(Document document, string id, string stepId, JObject check)
        {
            List<Element> elements = GetScopedElements(document, check);
            string parameterName = check.Value<string>("parameterName");
            double actual = parameterName == null ? elements.Count : elements.Sum(element => ReadNumericParameter(element.LookupParameter(parameterName)));
            double expected = check.Value<double?>("expected") ?? throw new InvalidOperationException("quantity expected is required.");
            double tolerance = check.Value<double?>("tolerance") ?? 0.000001;
            bool passed = Math.Abs(actual - expected) <= tolerance;
            return VerificationResult(id, "quantity", stepId, passed, passed ? "Quantity matched." : "Quantity did not match.",
                new { Count = elements.Count, Actual = actual, Expected = expected, Tolerance = tolerance }, elements.Select(item => item.Id.Value).Take(200).ToArray());
        }

        private AgentVerificationCheckResult VerifyEvidence(Document document, string id, string stepId, JObject check)
        {
            long[] ids = ReadIds(check["elementIds"]);
            int minimum = check.Value<int?>("minimumElementIds") ?? 1;
            if (minimum < 1) throw new InvalidOperationException("minimumElementIds must be at least one.");
            long? viewId = check.Value<long?>("viewId");
            int existing = ids.Count(value => document.GetElement(new ElementId(value)) != null);
            bool viewExists = !viewId.HasValue || document.GetElement(new ElementId(viewId.Value)) is View;
            bool passed = existing >= minimum && viewExists;
            return VerificationResult(id, "evidence", stepId, passed, passed ? "Evidence requirements matched." : "Evidence is incomplete.",
                new { ExistingElementIds = existing, MinimumElementIds = minimum, ViewExists = viewExists }, ids);
        }

        private static AgentVerificationCheckResult VerificationResult(string id, string kind, string stepId, bool passed, string message, object actual, long[] elementIds)
        {
            return new AgentVerificationCheckResult { Id = id, Kind = kind, StepId = stepId, Passed = passed, Message = message, Actual = actual, ElementIds = (elementIds ?? Array.Empty<long>()).Take(200).ToArray() };
        }

        private static long[] ReadIds(JToken value)
        {
            return value is JArray array ? array.Values<long>().Where(id => id > 0).Distinct().Take(200).ToArray() : Array.Empty<long>();
        }

        private static List<Element> GetScopedElements(Document document, JObject check)
        {
            long[] ids = ReadIds(check["elementIds"]);
            IEnumerable<Element> elements = ids.Length > 0
                ? ids.Select(id => document.GetElement(new ElementId(id))).Where(item => item != null)
                : new FilteredElementCollector(document).WhereElementIsNotElementType().Cast<Element>();
            string category = check.Value<string>("category");
            if (!string.IsNullOrWhiteSpace(category))
            {
                elements = elements.Where(item => item.Category != null && item.Category.Name.Equals(category, StringComparison.OrdinalIgnoreCase));
            }
            return elements.Take(5000).ToList();
        }

        private static bool ParameterMatches(Parameter parameter, JToken expected, double tolerance)
        {
            switch (parameter.StorageType)
            {
                case StorageType.Double: return Math.Abs(parameter.AsDouble() - expected.Value<double>()) <= tolerance;
                case StorageType.Integer: return parameter.AsInteger() == expected.Value<int>();
                case StorageType.ElementId: return parameter.AsElementId().Value == expected.Value<long>();
                case StorageType.String: return string.Equals(parameter.AsString() ?? string.Empty, expected.Value<string>() ?? string.Empty, StringComparison.Ordinal);
                default: return false;
            }
        }

        private static double ReadNumericParameter(Parameter parameter)
        {
            if (parameter == null) return 0.0;
            if (parameter.StorageType == StorageType.Double) return parameter.AsDouble();
            if (parameter.StorageType == StorageType.Integer) return parameter.AsInteger();
            return 0.0;
        }

        private static ConnectorManager GetConnectorManager(Element element)
        {
            if (element is MEPCurve curve) return curve.ConnectorManager;
            if (element is FamilyInstance family) return family.MEPModel?.ConnectorManager;
            return null;
        }

        private static double BoundingBoxDistance(BoundingBoxXYZ first, BoundingBoxXYZ second)
        {
            if (first == null || second == null) return 0.0;
            double dx = Math.Max(0.0, Math.Max(first.Min.X - second.Max.X, second.Min.X - first.Max.X));
            double dy = Math.Max(0.0, Math.Max(first.Min.Y - second.Max.Y, second.Min.Y - first.Max.Y));
            double dz = Math.Max(0.0, Math.Max(first.Min.Z - second.Max.Z, second.Min.Z - first.Max.Z));
            return Math.Sqrt(dx * dx + dy * dy + dz * dz);
        }
    }
}
