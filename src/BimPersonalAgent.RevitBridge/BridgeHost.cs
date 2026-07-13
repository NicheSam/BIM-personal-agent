using System;
using System.Threading.Tasks;
using Autodesk.Revit.UI;
using RevitMCP.Configuration;
using RevitMCP.Core;
using RevitMCP.Models;

namespace BimPersonalAgent.RevitBridge
{
    public static class BridgeHost
    {
        private static readonly object Sync = new object();
        private static SocketService _socketService;
        private static UIApplication _uiApplication;

        public static bool IsRunning => _socketService != null && _socketService.IsRunning;

        public static bool IsConnected => _socketService != null && _socketService.IsConnected;

        public static void Initialize()
        {
            _ = ExternalEventManager.Instance;
        }

        public static void Enqueue(Action<UIApplication> action)
        {
            ExternalEventManager.Instance.ExecuteCommand(action);
        }

        public static void Start(UIApplication uiApplication)
        {
            if (uiApplication == null)
            {
                throw new ArgumentNullException(nameof(uiApplication));
            }

            lock (Sync)
            {
                if (IsRunning)
                {
                    _uiApplication = uiApplication;
                    return;
                }

                Initialize();
                _uiApplication = uiApplication;
                ServiceSettings settings = ConfigManager.Instance.Settings;
                _socketService = new SocketService(settings);
                _socketService.CommandReceived += OnCommandReceived;
                _socketService.StartAsync().GetAwaiter().GetResult();
                settings.IsEnabled = true;
                ConfigManager.Instance.SaveSettings();
                Logger.Info("BIM Personal Agent Bridge started.");
            }
        }

        public static void Stop()
        {
            lock (Sync)
            {
                if (_socketService != null)
                {
                    _socketService.CommandReceived -= OnCommandReceived;
                    _socketService.Stop();
                    _socketService = null;
                }

                _uiApplication = null;
                ConfigManager.Instance.Settings.IsEnabled = false;
                ConfigManager.Instance.SaveSettings();
                Logger.Info("BIM Personal Agent Bridge stopped.");
            }
        }

        private static void OnCommandReceived(object sender, RevitCommandRequest request)
        {
            Enqueue(uiApplication =>
            {
                RevitCommandResponse response;
                try
                {
                    _uiApplication = uiApplication;
                    response = new CommandExecutor(uiApplication).ExecuteCommand(request);
                }
                catch (Exception exception)
                {
                    response = new RevitCommandResponse
                    {
                        Success = false,
                        Error = exception.Message,
                        ErrorCode = "REVIT_COMMAND_FAILED",
                        RequestId = request.RequestId
                    };
                }

                _ = SendResponseAsync(response);
            });
        }

        private static async Task SendResponseAsync(RevitCommandResponse response)
        {
            SocketService service = _socketService;
            if (service == null || !service.IsConnected)
            {
                return;
            }

            try
            {
                await service.SendResponseAsync(response).ConfigureAwait(false);
            }
            catch (Exception exception)
            {
                Logger.Error("BIM Personal Agent response send failed", exception);
            }
        }
    }
}
