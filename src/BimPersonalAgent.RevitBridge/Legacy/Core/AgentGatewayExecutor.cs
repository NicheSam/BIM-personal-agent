using System;
using System.Collections.Generic;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Newtonsoft.Json.Linq;
using RevitMCP.Models;

namespace RevitMCP.Core
{
    public partial class CommandExecutor
    {
        private static readonly HashSet<string> DisabledBridgeCommands =
            new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "copy_sheets_from_file",
                "dedup_detail_elements_in_view",
                "delete_element",
                "door-window-legend-tools",
                "export_families",
                "import_excel_to_drafting_views",
                "read_excel_tables"
            };

        private static readonly HashSet<string> NonAtomicOrDestructivePlanCommands =
            new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "copy_sheets_from_file",
                "dedup_detail_elements_in_view",
                "delete_element",
                "export_families",
                "import_excel_to_drafting_views",
                "read_source_file_sheets",
                "sync_sheet_parameters_from_source"
            };

        private static bool IsBridgeCommandDisabled(string commandName)
        {
            return DisabledBridgeCommands.Contains(commandName);
        }

        private object GetAgentStatus()
        {
            UIDocument uiDocument = _uiApp.ActiveUIDocument;
            Document document = uiDocument?.Document;
            return new
            {
                Connected = true,
                BridgeVersion = "0.5.0",
                RevitVersion = _uiApp.Application.VersionNumber,
                HasActiveDocument = document != null,
                ProjectName = document?.Title,
                ProjectFingerprint = document == null ? null : ComputeProjectFingerprint(document),
                PendingCommands = ExternalEventManager.Instance.PendingCount
            };
        }

        private object ExecuteAgentPlan(JObject parameters)
        {
            JArray steps = parameters["steps"] as JArray;
            if (steps == null || steps.Count < 1 || steps.Count > 20)
            {
                throw new InvalidOperationException("Agent plan must contain between 1 and 20 steps.");
            }

            var validated = new List<RevitCommandRequest>();
            foreach (JToken token in steps)
            {
                JObject step = token as JObject ?? throw new InvalidOperationException("Every Agent plan step must be an object.");
                string commandName = step.Value<string>("commandName");
                if (string.IsNullOrWhiteSpace(commandName) ||
                    commandName.Equals("execute_agent_plan", StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidOperationException("Agent plan contains an invalid command.");
                }

                if (IsBridgeCommandDisabled(commandName) ||
                    NonAtomicOrDestructivePlanCommands.Contains(commandName))
                {
                    throw new InvalidOperationException("Agent plan contains a destructive or non-atomic command: " + commandName);
                }

                validated.Add(new RevitCommandRequest
                {
                    CommandName = commandName,
                    Parameters = step["parameters"] as JObject ?? new JObject(),
                    RequestId = step.Value<string>("toolId") ?? Guid.NewGuid().ToString("N")
                });
            }

            UIDocument uiDocument = _uiApp.ActiveUIDocument;
            if (uiDocument == null)
            {
                throw new InvalidOperationException("No active Revit document.");
            }

            Document document = uiDocument.Document;
            string documentFingerprint = ComputeProjectFingerprint(document);
            var results = new List<object>();
            using (var group = new TransactionGroup(document, "BIM Personal Agent plan"))
            {
                group.Start();
                try
                {
                    foreach (RevitCommandRequest request in validated)
                    {
                        Document activeDocument = _uiApp.ActiveUIDocument?.Document;
                        if (activeDocument == null ||
                            !string.Equals(
                                ComputeProjectFingerprint(activeDocument),
                                documentFingerprint,
                                StringComparison.Ordinal))
                        {
                            throw new InvalidOperationException("The active Revit document changed during the Agent plan.");
                        }

                        RevitCommandResponse response = ExecuteCommand(request);
                        if (!response.Success)
                        {
                            throw new InvalidOperationException(response.Error ?? "Agent plan step failed.");
                        }

                        results.Add(new
                        {
                            ToolId = request.RequestId,
                            CommandName = request.CommandName,
                            response.Data
                        });
                    }

                    group.Assimilate();
                }
                catch
                {
                    if (group.GetStatus() == TransactionStatus.Started)
                    {
                        group.RollBack();
                    }

                    throw;
                }
            }

            return new
            {
                Atomic = true,
                ExecutedSteps = results.Count,
                TransactionName = "BIM Personal Agent plan",
                Results = results
            };
        }
    }
}
