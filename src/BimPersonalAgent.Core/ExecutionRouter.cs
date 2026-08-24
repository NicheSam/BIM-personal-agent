namespace BimPersonalAgent.Core
{
    public enum ExecutionRoute
    {
        ExistingTool,
        OperationPlan,
        GeneratedCSharpCandidate
    }

    public sealed class ToolPerformanceSnapshot
    {
        public string ToolName { get; set; }

        public int SampleCount { get; set; }

        public double P95DurationMs { get; set; }

        public double SuccessRate { get; set; }
    }

    public sealed class RouteRequest
    {
        public bool HasExistingTool { get; set; }

        public bool OperationPlanSupported { get; set; }

        public ToolPerformanceSnapshot ExistingToolPerformance { get; set; }

        public ExecutionRoute? PreferredRoute { get; set; }
    }

    public sealed class RouteDecision
    {
        internal RouteDecision(ExecutionRoute route, string reason)
        {
            Route = route;
            Reason = reason;
        }

        public ExecutionRoute Route { get; }

        public string Reason { get; }
    }

    public sealed class ExecutionRouter
    {
        private const int MinimumPerformanceSamples = 3;
        private const double MaximumHealthyP95Ms = 3000;
        private const double MinimumHealthySuccessRate = 0.95;

        public RouteDecision Choose(RouteRequest request)
        {
            if (request == null)
            {
                throw new System.ArgumentNullException(nameof(request));
            }

            if (request.PreferredRoute == ExecutionRoute.GeneratedCSharpCandidate)
            {
                return new RouteDecision(ExecutionRoute.GeneratedCSharpCandidate, "Model selected a reviewed C# candidate based on task shape or measured performance.");
            }

            if (request.PreferredRoute == ExecutionRoute.OperationPlan && request.OperationPlanSupported)
            {
                return new RouteDecision(ExecutionRoute.OperationPlan, "Model selected the bounded operation plan based on task shape or measured performance.");
            }

            if (request.PreferredRoute == ExecutionRoute.ExistingTool && request.HasExistingTool)
            {
                return new RouteDecision(ExecutionRoute.ExistingTool, "Model selected the existing tool.");
            }

            if (request.HasExistingTool && IsHealthyOrUnmeasured(request.ExistingToolPerformance))
            {
                return new RouteDecision(ExecutionRoute.ExistingTool, "Use the tested tool and continue collecting performance samples.");
            }

            if (request.OperationPlanSupported)
            {
                return new RouteDecision(ExecutionRoute.OperationPlan, "The existing tool is unavailable or underperforms; use the bounded operation-plan executor.");
            }

            return new RouteDecision(ExecutionRoute.GeneratedCSharpCandidate, "No healthy tool or bounded plan is available; generate a reviewed C# candidate without executing it directly.");
        }

        private static bool IsHealthyOrUnmeasured(ToolPerformanceSnapshot snapshot)
        {
            if (snapshot == null || snapshot.SampleCount < MinimumPerformanceSamples)
            {
                return true;
            }

            return snapshot.P95DurationMs <= MaximumHealthyP95Ms &&
                   snapshot.SuccessRate >= MinimumHealthySuccessRate;
        }
    }
}
