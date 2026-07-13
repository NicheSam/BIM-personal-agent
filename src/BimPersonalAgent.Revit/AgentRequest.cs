namespace BimPersonalAgent.Revit
{
    internal enum AgentRequestKind
    {
        InspectSelection,
        ApplyParameterChange
    }

    internal sealed class AgentRequest
    {
        public AgentRequestKind Kind { get; set; }

        public string ParameterName { get; set; }

        public string Value { get; set; }
    }
}
