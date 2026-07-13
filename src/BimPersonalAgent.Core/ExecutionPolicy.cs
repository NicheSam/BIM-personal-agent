namespace BimPersonalAgent.Core
{
    public enum OperationRisk
    {
        ReadOnly,
        ReversibleMutation,
        Destructive
    }

    public sealed class OperationScope
    {
        public string OperationName { get; set; }

        public OperationRisk Risk { get; set; }

        public int TargetCount { get; set; }

        public bool DeletesElements { get; set; }

        public bool DestructiveReplacement { get; set; }

        public bool IsUndoable { get; set; } = true;
    }

    public sealed class ExecutionPolicyDecision
    {
        internal ExecutionPolicyDecision(bool showScope, bool requiresConfirmation, string reason)
        {
            ShowScope = showScope;
            RequiresConfirmation = requiresConfirmation;
            Reason = reason;
        }

        public bool ShowScope { get; }

        public bool RequiresConfirmation { get; }

        public string Reason { get; }
    }

    public static class ExecutionPolicy
    {
        public static ExecutionPolicyDecision Evaluate(OperationScope scope)
        {
            if (scope == null)
            {
                throw new System.ArgumentNullException(nameof(scope));
            }

            bool destructive = scope.Risk == OperationRisk.Destructive ||
                               scope.DeletesElements ||
                               scope.DestructiveReplacement ||
                               !scope.IsUndoable;

            return destructive
                ? new ExecutionPolicyDecision(true, true, "Destructive operations require scope disclosure and confirmation.")
                : new ExecutionPolicyDecision(false, false, "Read and reversible create/modify operations run without confirmation.");
        }
    }
}
