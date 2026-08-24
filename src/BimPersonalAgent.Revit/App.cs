using System;
using System.Linq;
using System.Reflection;
using Autodesk.Revit.UI;
using BimPersonalAgent.RevitBridge;

namespace BimPersonalAgent.Revit
{
    public sealed class App : IExternalApplication
    {
        private const string RibbonTabName = "BIM Personal";
        private const string RibbonPanelName = "Agent 服務";

        public Result OnStartup(UIControlledApplication application)
        {
            try
            {
                BridgeHost.Initialize();
                RegisterRibbon(application);
                return Result.Succeeded;
            }
            catch (Exception exception)
            {
                TaskDialog.Show("BIM Personal Agent", "外掛載入失敗：" + exception.Message);
                return Result.Failed;
            }
        }

        public Result OnShutdown(UIControlledApplication application)
        {
            BridgeHost.Stop();
            return Result.Succeeded;
        }

        private static void RegisterRibbon(UIControlledApplication application)
        {
            try
            {
                application.CreateRibbonTab(RibbonTabName);
            }
            catch (Autodesk.Revit.Exceptions.ArgumentException)
            {
                // The tab can already exist when other personal tools share it.
            }

            RibbonPanel panel = application.GetRibbonPanels(RibbonTabName)
                .FirstOrDefault(item => item.Name == RibbonPanelName)
                ?? application.CreateRibbonPanel(RibbonTabName, RibbonPanelName);

            string assemblyPath = Assembly.GetExecutingAssembly().Location;
            var bridgeButtonData = new PushButtonData(
                "BimPersonalAgent.ToggleBridge",
                "Agent服務\n開/關",
                assemblyPath,
                typeof(ToggleAgentBridgeCommand).FullName)
            {
                ToolTip = "啟動或停止 BIM Personal Agent 本機連線服務。任務請從 Codex 輸入，執行紀錄顯示於瀏覽器工作台。"
            };
            panel.AddItem(bridgeButtonData);
        }
    }
}
