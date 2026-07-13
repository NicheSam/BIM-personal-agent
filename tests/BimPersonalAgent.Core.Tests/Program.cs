using System;
using BimPersonalAgent.Core;

namespace BimPersonalAgent.Core.Tests
{
    internal static class Program
    {
        private static int _failures;

        private static int Main()
        {
            var parser = new CommandParser();

            AssertInspect(parser.Parse("檢查選取"));
            AssertInspect(parser.Parse("inspect selection"));
            AssertSet(parser.Parse("設定 備註 = 已檢查"), "備註", "已檢查");
            AssertSet(parser.Parse("設定參數 「Mark」 為 「A-01」"), "Mark", "A-01");
            AssertSet(parser.Parse("set Comments to Reviewed"), "Comments", "Reviewed");
            AssertFailure(parser.Parse(""));
            AssertFailure(parser.Parse("刪除全部牆"));
            AssertFailure(parser.Parse("設定 備註"));
            AssertFailure(parser.Parse("設定 = 值"));
            AssertFailure(parser.Parse(new string('x', 1201)));
            AssertExecutionPolicy();
            AssertExecutionRouting();
            AssertOperationPlanExecution();

            if (_failures == 0)
            {
                Console.WriteLine("All command parser tests passed.");
                return 0;
            }

            Console.Error.WriteLine(_failures + " test(s) failed.");
            return 1;
        }

        private static void AssertInspect(CommandParseResult result)
        {
            Assert(result.Success, "Expected a successful inspect command.");
            Assert(result.Intent != null && result.Intent.Kind == CommandKind.InspectSelection,
                "Expected InspectSelection intent.");
        }

        private static void AssertSet(CommandParseResult result, string parameterName, string value)
        {
            Assert(result.Success, "Expected a successful set command.");
            Assert(result.Intent != null && result.Intent.Kind == CommandKind.SetParameter,
                "Expected SetParameter intent.");
            Assert(result.Intent != null && result.Intent.ParameterName == parameterName,
                "Unexpected parameter name.");
            Assert(result.Intent != null && result.Intent.Value == value,
                "Unexpected parameter value.");
        }

        private static void AssertFailure(CommandParseResult result)
        {
            Assert(!result.Success, "Expected parsing to fail.");
            Assert(!string.IsNullOrWhiteSpace(result.Error), "Expected a useful error message.");
        }

        private static void AssertExecutionPolicy()
        {
            ExecutionPolicyDecision modify = ExecutionPolicy.Evaluate(new OperationScope
            {
                OperationName = "modify_element_parameter",
                Risk = OperationRisk.ReversibleMutation,
                TargetCount = 20,
                IsUndoable = true
            });
            Assert(!modify.ShowScope && !modify.RequiresConfirmation,
                "Reversible modifications should execute without confirmation.");

            ExecutionPolicyDecision delete = ExecutionPolicy.Evaluate(new OperationScope
            {
                OperationName = "delete_elements",
                Risk = OperationRisk.Destructive,
                TargetCount = 5,
                DeletesElements = true,
                IsUndoable = true
            });
            Assert(delete.ShowScope && delete.RequiresConfirmation,
                "Destructive operations must show scope and require confirmation.");
        }

        private static void AssertExecutionRouting()
        {
            var router = new ExecutionRouter();
            RouteDecision baseline = router.Choose(new RouteRequest
            {
                HasExistingTool = true,
                OperationPlanSupported = true,
                ExistingToolPerformance = new ToolPerformanceSnapshot
                {
                    ToolName = "get_element_info",
                    SampleCount = 2,
                    P95DurationMs = 9000,
                    SuccessRate = 0.5
                }
            });
            Assert(baseline.Route == ExecutionRoute.ExistingTool,
                "An existing tool needs a minimum sample baseline before rerouting.");

            RouteDecision slowTool = router.Choose(new RouteRequest
            {
                HasExistingTool = true,
                OperationPlanSupported = true,
                ExistingToolPerformance = new ToolPerformanceSnapshot
                {
                    ToolName = "query_elements_with_filter",
                    SampleCount = 10,
                    P95DurationMs = 6000,
                    SuccessRate = 1
                }
            });
            Assert(slowTool.Route == ExecutionRoute.OperationPlan,
                "A measured slow tool should reroute to the bounded operation plan.");

            RouteDecision modelOverride = router.Choose(new RouteRequest
            {
                HasExistingTool = true,
                OperationPlanSupported = true,
                PreferredRoute = ExecutionRoute.GeneratedCSharpCandidate,
                ExistingToolPerformance = new ToolPerformanceSnapshot
                {
                    ToolName = "modify_element_parameter",
                    SampleCount = 20,
                    P95DurationMs = 100,
                    SuccessRate = 1
                }
            });
            Assert(modelOverride.Route == ExecutionRoute.GeneratedCSharpCandidate,
                "Performance guidance must not prevent a model-selected candidate route.");

            RouteDecision csharp = router.Choose(new RouteRequest
            {
                HasExistingTool = false,
                OperationPlanSupported = false
            });
            Assert(csharp.Route == ExecutionRoute.GeneratedCSharpCandidate,
                "Unsupported work should produce a reviewed C# candidate.");
        }

        private static void AssertOperationPlanExecution()
        {
            var executor = new RevitOperationPlanExecutor(new[]
            {
                new OperationToolPolicy
                {
                    ToolId = "modify_element_parameter",
                    MinimumRisk = OperationRisk.ReversibleMutation
                },
                new OperationToolPolicy
                {
                    ToolId = "delete_elements",
                    MinimumRisk = OperationRisk.Destructive
                }
            });
            int executed = 0;
            var reversiblePlan = new RevitOperationPlan
            {
                Steps = new[]
                {
                    new RevitOperationStep
                    {
                        ToolId = "modify_element_parameter",
                        Arguments = new System.Collections.Generic.Dictionary<string, object>
                        {
                            ["parameterName"] = "Comments",
                            ["value"] = "Reviewed"
                        },
                        Scope = new OperationScope
                        {
                            OperationName = "modify_element_parameter",
                            Risk = OperationRisk.ReversibleMutation,
                            TargetCount = 1
                        }
                    }
                }
            };
            OperationPlanResult reversibleResult = executor.Execute(
                reversiblePlan,
                false,
                step => { executed++; return "ok"; });
            Assert(reversibleResult.ExecutedSteps == 1 && executed == 1,
                "A reversible plan should execute without confirmation.");

            var destructivePlan = new RevitOperationPlan
            {
                Steps = new[]
                {
                    new RevitOperationStep
                    {
                        ToolId = "delete_elements",
                        Arguments = new System.Collections.Generic.Dictionary<string, object>(),
                        Scope = new OperationScope
                        {
                            OperationName = "delete_elements",
                            Risk = OperationRisk.Destructive,
                            TargetCount = 3,
                            DeletesElements = true
                        }
                    }
                }
            };
            OperationPlanResult blockedResult = executor.Execute(
                destructivePlan,
                false,
                step => { executed++; return "blocked"; });
            Assert(blockedResult.ExecutedSteps == 0 && blockedResult.RequiresConfirmation,
                "A destructive plan must be blocked before execution when unconfirmed.");

            OperationPlanResult confirmedResult = executor.Execute(
                destructivePlan,
                true,
                step => { executed++; return "confirmed"; });
            Assert(confirmedResult.ExecutedSteps == 1,
                "A confirmed destructive plan should execute.");

            destructivePlan.Steps[0].Scope.Risk = OperationRisk.ReadOnly;
            OperationPlanResult downgradedResult = executor.Execute(
                destructivePlan,
                false,
                step => { executed++; return "blocked"; });
            Assert(downgradedResult.ExecutedSteps == 0 && downgradedResult.RequiresConfirmation,
                "A model must not downgrade the registered risk of a destructive tool.");
        }

        private static void Assert(bool condition, string message)
        {
            if (condition)
            {
                return;
            }

            _failures++;
            Console.Error.WriteLine(message);
        }
    }
}
