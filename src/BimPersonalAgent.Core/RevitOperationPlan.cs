using System;
using System.Collections.Generic;
using System.Linq;

namespace BimPersonalAgent.Core
{
    public sealed class RevitOperationStep
    {
        public string ToolId { get; set; }

        public string Version { get; set; }

        public IReadOnlyDictionary<string, object> Arguments { get; set; }

        public OperationScope Scope { get; set; }

        public bool AtomicCompatible { get; set; } = true;
    }

    public sealed class RevitOperationPlan
    {
        public IReadOnlyList<RevitOperationStep> Steps { get; set; }
    }

    public sealed class OperationToolPolicy
    {
        public string ToolId { get; set; }

        public OperationRisk MinimumRisk { get; set; }
    }

    public sealed class OperationPlanResult
    {
        internal OperationPlanResult(int executedSteps, bool requiresConfirmation, IReadOnlyList<object> stepResults)
        {
            ExecutedSteps = executedSteps;
            RequiresConfirmation = requiresConfirmation;
            StepResults = stepResults;
        }

        public int ExecutedSteps { get; }

        public bool RequiresConfirmation { get; }

        public IReadOnlyList<object> StepResults { get; }
    }

    public sealed class RevitOperationPlanExecutor
    {
        private readonly Dictionary<string, OperationRisk> _toolPolicies;

        public RevitOperationPlanExecutor(IEnumerable<OperationToolPolicy> toolPolicies)
        {
            if (toolPolicies == null)
            {
                throw new ArgumentNullException(nameof(toolPolicies));
            }

            _toolPolicies = toolPolicies.ToDictionary(
                policy => policy.ToolId,
                policy => policy.MinimumRisk,
                StringComparer.Ordinal);
        }

        public OperationPlanResult Execute(
            RevitOperationPlan plan,
            bool destructiveOperationConfirmed,
            Func<RevitOperationStep, object> executeStep)
        {
            if (executeStep == null)
            {
                throw new ArgumentNullException(nameof(executeStep));
            }

            IReadOnlyList<RevitOperationStep> steps = Validate(plan);
            bool requiresConfirmation = steps.Any(RequiresConfirmation);

            if (requiresConfirmation && !destructiveOperationConfirmed)
            {
                return new OperationPlanResult(0, true, Array.Empty<object>());
            }

            var results = new List<object>();
            foreach (RevitOperationStep step in steps)
            {
                results.Add(executeStep(step));
            }

            return new OperationPlanResult(steps.Count, requiresConfirmation, results);
        }

        private IReadOnlyList<RevitOperationStep> Validate(RevitOperationPlan plan)
        {
            if (plan?.Steps == null || plan.Steps.Count == 0)
            {
                throw new InvalidOperationException("Operation plan must contain at least one step.");
            }

            foreach (RevitOperationStep step in plan.Steps)
            {
                if (step == null || string.IsNullOrWhiteSpace(step.ToolId) || step.Scope == null || step.Arguments == null)
                {
                    throw new InvalidOperationException("Every operation-plan step requires a tool, arguments, and scope.");
                }

                if (!_toolPolicies.ContainsKey(step.ToolId))
                {
                    throw new InvalidOperationException("Operation plan contains a tool outside the allowlist: " + step.ToolId);
                }

                if (!step.AtomicCompatible)
                {
                    throw new InvalidOperationException("Operation plan contains a non-atomic step: " + step.ToolId);
                }
            }

            return plan.Steps;
        }

        private bool RequiresConfirmation(RevitOperationStep step)
        {
            return _toolPolicies[step.ToolId] == OperationRisk.Destructive ||
                   ExecutionPolicy.Evaluate(step.Scope).RequiresConfirmation;
        }
    }
}
