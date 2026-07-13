using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace BimPersonalAgent.Revit
{
    internal sealed class RevitRequestHandler
    {
        private const int MaxSelectedElements = 1000;

        private readonly AgentPane _pane;

        public RevitRequestHandler(AgentPane pane)
        {
            _pane = pane;
        }

        internal void Execute(UIApplication application, AgentRequest request)
        {
            if (request == null)
            {
                return;
            }

            try
            {
                if (application.ActiveUIDocument == null)
                {
                    _pane.ShowRows(Array.Empty<OperationRow>(), "目前沒有開啟的 Revit 專案。");
                    return;
                }

                switch (request.Kind)
                {
                    case AgentRequestKind.InspectSelection:
                        InspectSelection(application.ActiveUIDocument);
                        break;
                    case AgentRequestKind.ApplyParameterChange:
                        ApplyParameterChange(application.ActiveUIDocument, request);
                        break;
                    default:
                        throw new InvalidOperationException("未知的作業類型。");
                }
            }
            catch (Exception exception)
            {
                _pane.ShowRows(Array.Empty<OperationRow>(), "作業失敗：" + exception.Message);
            }
        }

        private void InspectSelection(UIDocument uiDocument)
        {
            Document document = uiDocument.Document;
            List<Element> elements = GetSelectedElements(uiDocument);
            var rows = elements.Select(element => new OperationRow
            {
                Id = element.Id.Value,
                Category = element.Category?.Name ?? "(無類別)",
                Element = GetElementName(document, element),
                CurrentValue = GetTypeName(document, element),
                State = "已讀取"
            }).ToList();

            string status = rows.Count == 0
                ? "目前沒有選取元素。"
                : "已讀取 " + rows.Count + " 個元素；未修改模型。";
            _pane.ShowRows(rows, status);
        }

        private void ApplyParameterChange(UIDocument uiDocument, AgentRequest request)
        {
            Document document = uiDocument.Document;
            List<Element> elements = GetSelectedElements(uiDocument);
            var rows = new List<OperationRow>();
            var eligibleIds = new List<long>();

            foreach (Element element in elements)
            {
                OperationRow row = BuildBaseRow(document, element, request.ParameterName, request.Value);
                Parameter parameter;
                string reason;
                if (!TryGetWritableParameter(element, request.ParameterName, out parameter, out reason))
                {
                    row.State = reason;
                    rows.Add(row);
                    continue;
                }

                int integerValue;
                if (parameter.StorageType == StorageType.String)
                {
                    row.CurrentValue = parameter.AsString() ?? string.Empty;
                }
                else if (parameter.StorageType == StorageType.Integer && TryParseInteger(request.Value, out integerValue))
                {
                    row.CurrentValue = parameter.AsInteger().ToString(CultureInfo.CurrentCulture);
                }
                else
                {
                    row.State = "首版僅支援文字或整數";
                    rows.Add(row);
                    continue;
                }

                row.State = "準備套用";
                eligibleIds.Add(element.Id.Value);
                rows.Add(row);
            }

            if (eligibleIds.Count == 0)
            {
                string status = elements.Count == 0
                    ? "目前沒有選取元素。"
                    : "沒有可修改的元素。";
                _pane.ShowRows(rows, status);
                return;
            }

            int applied = 0;

            using (var transaction = new Transaction(document, "BIM 個人作業台：批次設定參數"))
            {
                transaction.Start();

                foreach (long elementId in eligibleIds)
                {
                    Element element = document.GetElement(new ElementId(elementId));
                    if (element == null)
                    {
                        rows.Add(new OperationRow { Id = elementId, State = "元素已不存在" });
                        continue;
                    }

                    OperationRow row = rows.First(item => item.Id == elementId);
                    Parameter parameter;
                    string reason;
                    if (!TryGetWritableParameter(element, request.ParameterName, out parameter, out reason))
                    {
                        row.State = reason;
                        rows.Add(row);
                        continue;
                    }

                    try
                    {
                        bool changed;
                        using (var subTransaction = new SubTransaction(document))
                        {
                            subTransaction.Start();
                            changed = SetSupportedValue(parameter, request.Value);
                            if (changed)
                            {
                                subTransaction.Commit();
                            }
                            else
                            {
                                subTransaction.RollBack();
                            }
                        }

                        row.State = changed ? "已套用" : "Revit 拒絕此值";
                        if (changed)
                        {
                            applied++;
                        }
                    }
                    catch (Exception exception)
                    {
                        row.State = "失敗：" + exception.Message;
                    }
                }

                if (applied > 0)
                {
                    transaction.Commit();
                }
                else
                {
                    transaction.RollBack();
                }
            }

            _pane.ShowRows(
                rows,
                "完成：" + applied + " 個已套用，" + (rows.Count - applied) + " 個未修改。可從 Revit Undo 復原。");
        }

        private static List<Element> GetSelectedElements(UIDocument uiDocument)
        {
            ICollection<ElementId> selectedIds = uiDocument.Selection.GetElementIds();
            if (selectedIds.Count > MaxSelectedElements)
            {
                throw new InvalidOperationException(
                    "一次最多處理 " + MaxSelectedElements + " 個元素；請縮小選取範圍。");
            }

            return selectedIds
                .Select(id => uiDocument.Document.GetElement(id))
                .Where(element => element != null)
                .OrderBy(element => element.Id.Value)
                .ToList();
        }

        private static OperationRow BuildBaseRow(
            Document document,
            Element element,
            string parameterName,
            string proposedValue)
        {
            return new OperationRow
            {
                Id = element.Id.Value,
                Category = element.Category?.Name ?? "(無類別)",
                Element = GetElementName(document, element),
                Parameter = parameterName,
                ProposedValue = proposedValue
            };
        }

        private static bool TryGetWritableParameter(
            Element element,
            string parameterName,
            out Parameter parameter,
            out string reason)
        {
            List<Parameter> matches = element.Parameters
                .Cast<Parameter>()
                .Where(item => item.Definition != null &&
                               string.Equals(item.Definition.Name, parameterName, StringComparison.OrdinalIgnoreCase))
                .ToList();

            if (matches.Count == 0)
            {
                parameter = null;
                reason = "找不到參數";
                return false;
            }

            if (matches.Count > 1)
            {
                parameter = null;
                reason = "同名參數不唯一";
                return false;
            }

            parameter = matches[0];
            if (parameter.IsReadOnly)
            {
                reason = "參數唯讀";
                return false;
            }

            reason = null;
            return true;
        }

        private static bool SetSupportedValue(Parameter parameter, string value)
        {
            if (parameter.StorageType == StorageType.String)
            {
                return parameter.Set(value);
            }

            int integerValue;
            if (parameter.StorageType == StorageType.Integer && TryParseInteger(value, out integerValue))
            {
                return parameter.Set(integerValue);
            }

            return false;
        }

        private static bool TryParseInteger(string value, out int result)
        {
            if (int.TryParse(value, NumberStyles.Integer, CultureInfo.CurrentCulture, out result))
            {
                return true;
            }

            switch ((value ?? string.Empty).Trim().ToLowerInvariant())
            {
                case "true":
                case "yes":
                case "是":
                    result = 1;
                    return true;
                case "false":
                case "no":
                case "否":
                    result = 0;
                    return true;
                default:
                    result = 0;
                    return false;
            }
        }

        private static string GetElementName(Document document, Element element)
        {
            var familyInstance = element as FamilyInstance;
            if (familyInstance?.Symbol != null)
            {
                return familyInstance.Symbol.FamilyName + " : " + familyInstance.Symbol.Name;
            }

            string name = element.Name;
            return string.IsNullOrWhiteSpace(name) ? GetTypeName(document, element) : name;
        }

        private static string GetTypeName(Document document, Element element)
        {
            ElementId typeId = element.GetTypeId();
            if (typeId == ElementId.InvalidElementId)
            {
                return "(無類型)";
            }

            Element type = document.GetElement(typeId);
            return type?.Name ?? "(無類型)";
        }
    }
}
