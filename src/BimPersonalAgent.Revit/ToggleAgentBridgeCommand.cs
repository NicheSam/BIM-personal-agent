using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using BimPersonalAgent.RevitBridge;

namespace BimPersonalAgent.Revit
{
    [Transaction(TransactionMode.Manual)]
    public sealed class ToggleAgentBridgeCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            try
            {
                if (BridgeHost.IsRunning)
                {
                    BridgeHost.Stop();
                    TaskDialog.Show("BIM Personal Agent", "Agent 服務已停止。");
                }
                else
                {
                    BridgeHost.Start(commandData.Application);
                    TaskDialog.Show("BIM Personal Agent", "Agent 服務已啟動，正在監聽 localhost:9686。");
                }

                return Result.Succeeded;
            }
            catch (System.Exception exception)
            {
                message = exception.Message;
                return Result.Failed;
            }
        }
    }
}
