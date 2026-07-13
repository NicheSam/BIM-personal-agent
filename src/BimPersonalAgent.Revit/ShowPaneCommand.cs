using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace BimPersonalAgent.Revit
{
    [Transaction(TransactionMode.ReadOnly)]
    public sealed class ShowPaneCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            commandData.Application.GetDockablePane(App.PaneId).Show();
            return Result.Succeeded;
        }
    }
}
