namespace BimPersonalAgent.Revit
{
    internal sealed class OperationRow
    {
        public long Id { get; set; }

        public string Category { get; set; }

        public string Element { get; set; }

        public string Parameter { get; set; }

        public string CurrentValue { get; set; }

        public string ProposedValue { get; set; }

        public string State { get; set; }
    }
}
