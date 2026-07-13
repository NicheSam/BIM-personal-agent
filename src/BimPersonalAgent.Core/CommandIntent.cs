namespace BimPersonalAgent.Core
{
    public enum CommandKind
    {
        InspectSelection,
        SetParameter
    }

    public sealed class CommandIntent
    {
        private CommandIntent(CommandKind kind, string parameterName, string value)
        {
            Kind = kind;
            ParameterName = parameterName;
            Value = value;
        }

        public CommandKind Kind { get; }

        public string ParameterName { get; }

        public string Value { get; }

        public static CommandIntent InspectSelection()
        {
            return new CommandIntent(CommandKind.InspectSelection, null, null);
        }

        public static CommandIntent SetParameter(string parameterName, string value)
        {
            return new CommandIntent(CommandKind.SetParameter, parameterName, value);
        }
    }

    public sealed class CommandParseResult
    {
        private CommandParseResult(bool success, CommandIntent intent, string error)
        {
            Success = success;
            Intent = intent;
            Error = error;
        }

        public bool Success { get; }

        public CommandIntent Intent { get; }

        public string Error { get; }

        public static CommandParseResult Parsed(CommandIntent intent)
        {
            return new CommandParseResult(true, intent, null);
        }

        public static CommandParseResult Failed(string error)
        {
            return new CommandParseResult(false, null, error);
        }
    }
}
