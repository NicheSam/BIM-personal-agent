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
        private const string RibbonPanelName = "個人作業台";

        internal static readonly DockablePaneId PaneId =
            new DockablePaneId(new Guid("5ef2deaa-5bc3-4dc0-911d-d20ff04c3050"));

        public Result OnStartup(UIControlledApplication application)
        {
            try
            {
                var pane = new AgentPane();
                var handler = new RevitRequestHandler(pane);
                BridgeHost.Initialize();
                pane.Initialize(request => BridgeHost.Enqueue(uiApplication => handler.Execute(uiApplication, request)));

                application.RegisterDockablePane(PaneId, "BIM Personal Agent", pane);
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
            var buttonData = new PushButtonData(
                "BimPersonalAgent.ShowPane",
                "開啟\n作業台",
                assemblyPath,
                typeof(ShowPaneCommand).FullName)
            {
                ToolTip = "開啟選取檢查與安全批次參數作業台"
            };

            panel.AddItem(buttonData);

            var bridgeButtonData = new PushButtonData(
                "BimPersonalAgent.ToggleBridge",
                "Agent服務\n開/關",
                assemblyPath,
                typeof(ToggleAgentBridgeCommand).FullName)
            {
                ToolTip = "啟動或停止 BIM Personal Agent 本機連線服務"
            };
            panel.AddItem(bridgeButtonData);
        }
    }
}
