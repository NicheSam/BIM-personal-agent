using System;

namespace BimPersonalAgent.Core
{
    public sealed class CommandParser
    {
        private const int MaxCommandLength = 1200;

        private static readonly string[] InspectCommands =
        {
            "檢查選取",
            "查看選取",
            "inspect",
            "inspect selection"
        };

        private static readonly string[] SetPrefixes =
        {
            "設定參數",
            "設定",
            "set parameter",
            "set"
        };

        public CommandParseResult Parse(string input)
        {
            string command = (input ?? string.Empty).Trim();
            if (command.Length == 0)
            {
                return CommandParseResult.Failed("請輸入指令。");
            }

            if (command.Length > MaxCommandLength)
            {
                return CommandParseResult.Failed("指令過長，請縮短後再試。");
            }

            foreach (string inspectCommand in InspectCommands)
            {
                if (string.Equals(command, inspectCommand, StringComparison.OrdinalIgnoreCase))
                {
                    return CommandParseResult.Parsed(CommandIntent.InspectSelection());
                }
            }

            string assignment = RemoveSetPrefix(command);
            if (assignment == null)
            {
                return CommandParseResult.Failed("目前只支援「檢查選取」與「設定 參數 = 值」。");
            }

            int separatorIndex;
            int separatorLength;
            if (!TryFindSeparator(assignment, out separatorIndex, out separatorLength))
            {
                return CommandParseResult.Failed("設定指令需要參數名稱與值，例如：設定 備註 = 已檢查。");
            }

            string parameterName = TrimQuotes(assignment.Substring(0, separatorIndex).Trim());
            string value = TrimQuotes(assignment.Substring(separatorIndex + separatorLength).Trim());

            if (parameterName.Length == 0)
            {
                return CommandParseResult.Failed("參數名稱不能空白。");
            }

            if (value.Length == 0)
            {
                return CommandParseResult.Failed("參數值不能空白。");
            }

            return CommandParseResult.Parsed(CommandIntent.SetParameter(parameterName, value));
        }

        private static string RemoveSetPrefix(string command)
        {
            foreach (string prefix in SetPrefixes)
            {
                if (!command.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                string remainder = command.Substring(prefix.Length);
                if (remainder.Length == 0 || char.IsWhiteSpace(remainder[0]))
                {
                    return remainder.Trim();
                }
            }

            return null;
        }

        private static bool TryFindSeparator(string assignment, out int index, out int length)
        {
            index = assignment.IndexOf('=');
            if (index >= 0)
            {
                length = 1;
                return true;
            }

            index = assignment.IndexOf('為');
            if (index >= 0)
            {
                length = 1;
                return true;
            }

            index = assignment.IndexOf(" to ", StringComparison.OrdinalIgnoreCase);
            if (index >= 0)
            {
                length = 4;
                return true;
            }

            length = 0;
            return false;
        }

        private static string TrimQuotes(string value)
        {
            return value.Trim('"', '\'', '「', '」', '『', '』');
        }
    }
}
